import { db } from "@/lib/db";
import { lookupAgentContact } from "@/server/etl/apollo-client";
import {
  findContactViaAgent,
  type ContactGrounding,
} from "@/server/agents/contact-finder/agent";
import { extractBridgeAgentFields } from "@/server/agents/chat-asset/prompt";

/**
 * Contact enrichment — resolves the listing agent's phone + email through an
 * ordered fallback chain, merging what each source can supply:
 *
 *   1. bridge     — phone/email already on the listing's synced Bridge `raw`
 *                   (free; `sfar` IDX usually strips these, a future VOW feed
 *                   would light them up).
 *   2. agent_llm  — headless LLM contact-finder (web_search + Bridge lookup).
 *   3. apollo     — Apollo People-Match by agent name + brokerage (email-only).
 *
 * We advance to the next source only while the agent phone OR email is still
 * missing, and stop once both are filled. Fields any source found along the
 * way are kept even if that source didn't fill everything.
 *
 * Refresh policy. Hits (we found a phone or email) re-check every 30 days
 * (catches agent moves); misses retry after 30 days too. Never throws on a
 * source failure — logs and returns `error` so the ETL keeps moving.
 */
const HIT_REFRESH_MS = 30 * 24 * 60 * 60 * 1000;
const MISS_REFRESH_MS = 30 * 24 * 60 * 60 * 1000;

/** Source priority — also the display order in the joined `source` tag. */
const SOURCE_ORDER = ["bridge", "agent_llm", "apollo"] as const;
type Source = (typeof SOURCE_ORDER)[number];

export type EnrichResult =
  | { status: "skipped"; reason: "fresh" }
  | { status: "hit"; source: string }
  | { status: "miss" }
  | { status: "error"; error: string };

type ListingForEnrichment = {
  mlsId: string;
  address: string;
  city: string | null;
  state: string | null;
  postalCode: string | null;
  raw: unknown;
};

type ContactFields = {
  agentName: string | null;
  agentPhone: string | null;
  agentEmail: string | null;
  agentWebsite: string | null;
  officeName: string | null;
  officePhone: string | null;
  officeEmail: string | null;
  officeWebsite: string | null;
};

const CONTACT_KEYS = [
  "agentName",
  "agentPhone",
  "agentEmail",
  "agentWebsite",
  "officeName",
  "officePhone",
  "officeEmail",
  "officeWebsite",
] as const;

function emptyContact(): ContactFields {
  return {
    agentName: null,
    agentPhone: null,
    agentEmail: null,
    agentWebsite: null,
    officeName: null,
    officePhone: null,
    officeEmail: null,
    officeWebsite: null,
  };
}

function str(v: unknown): string | null {
  return typeof v === "string" && v.trim().length > 0 ? v.trim() : null;
}

/** True once we have the two fields the downstream Gmail draft + UI care about. */
function hasBoth(c: ContactFields): boolean {
  return Boolean(c.agentPhone && c.agentEmail);
}

/**
 * Fill only still-empty fields of `merged` from `incoming`, recording which
 * source supplied each newly-filled field. Returns true if it contributed
 * anything.
 */
function fillFrom(
  merged: ContactFields,
  provenance: Record<string, Source>,
  source: Source,
  incoming: Partial<ContactFields>,
): boolean {
  let contributed = false;
  for (const key of CONTACT_KEYS) {
    if (!merged[key] && incoming[key]) {
      merged[key] = incoming[key]!;
      provenance[key] = source;
      contributed = true;
    }
  }
  return contributed;
}

/** "John A. Smith" → { firstName: "John", lastName: "A. Smith" }. */
function splitName(full: string | null): {
  firstName: string | null;
  lastName: string | null;
} {
  if (!full) return { firstName: null, lastName: null };
  const parts = full.trim().split(/\s+/);
  if (parts.length === 1) return { firstName: parts[0] ?? null, lastName: null };
  return { firstName: parts[0] ?? null, lastName: parts.slice(1).join(" ") };
}

/** Step 1 — read agent/office phone/email straight off the Bridge raw payload. */
function fromBridge(raw: unknown): Partial<ContactFields> {
  const r = (raw ?? {}) as Record<string, unknown>;
  return {
    agentName: str(r.ListAgentFullName),
    agentPhone: str(r.ListAgentDirectPhone) ?? str(r.ListAgentOfficePhone),
    agentEmail: str(r.ListAgentEmail),
    officeName: str(r.ListOfficeName),
    officePhone: str(r.ListOfficePhone),
  };
}

export async function enrichListingContact(
  listing: ListingForEnrichment,
  opts: { force?: boolean } = {},
): Promise<EnrichResult> {
  if (!opts.force) {
    const existing = await db.listingContact.findUnique({
      where: { listingMlsId: listing.mlsId },
      select: { fetchedAt: true, source: true },
    });
    if (existing) {
      const age = Date.now() - existing.fetchedAt.getTime();
      const isMiss = existing.source.includes("miss");
      const window = isMiss ? MISS_REFRESH_MS : HIT_REFRESH_MS;
      if (age < window) return { status: "skipped", reason: "fresh" };
    }
  }

  const merged = emptyContact();
  const provenance: Record<string, Source> = {};

  try {
    // 1. Bridge (free — already-synced raw fields).
    fillFrom(merged, provenance, "bridge", fromBridge(listing.raw));

    // 2. LLM contact-finder — only if we still lack phone or email.
    if (!hasBoth(merged)) {
      const grounding: ContactGrounding = {
        mlsId: listing.mlsId,
        address: listing.address,
        city: listing.city,
        state: listing.state,
        bridgeAgent: extractBridgeAgentFields(listing.raw),
        known: {
          agentName: merged.agentName,
          agentPhone: merged.agentPhone,
          agentEmail: merged.agentEmail,
          officeName: merged.officeName,
          officePhone: merged.officePhone,
          officeEmail: merged.officeEmail,
        },
      };
      const llm = await findContactViaAgent(grounding);
      if (llm) {
        fillFrom(merged, provenance, "agent_llm", {
          agentName: str(llm.agentName),
          agentPhone: str(llm.agentPhone),
          agentEmail: str(llm.agentEmail),
          officeName: str(llm.officeName),
          officePhone: str(llm.officePhone),
          officeEmail: str(llm.officeEmail),
        });
      }
    }

    // 3. Apollo (email-only) — only if we still lack phone or email.
    if (!hasBoth(merged)) {
      const { firstName, lastName } = splitName(merged.agentName);
      const apollo = await lookupAgentContact({
        firstName,
        lastName,
        organizationName: merged.officeName,
      });
      if (apollo) {
        fillFrom(merged, provenance, "apollo", {
          agentName: apollo.agentName,
          agentPhone: apollo.agentPhone,
          agentEmail: apollo.agentEmail,
          officeName: apollo.officeName,
          officePhone: apollo.officePhone,
        });
      }
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    // eslint-disable-next-line no-console
    console.warn(`[contacts] mlsId=${listing.mlsId} chain error: ${message}`);
    return { status: "error", error: message };
  }

  // A "hit" means we resolved a phone or email — a name alone doesn't unblock
  // the Contact card / rent-roll draft. On a miss we still persist any names we
  // found (harmless, and the drawer shows them) but tag `contact_miss` so the
  // shorter retry window applies.
  const found = Boolean(merged.agentPhone || merged.agentEmail);
  const sources = SOURCE_ORDER.filter((s) =>
    Object.values(provenance).includes(s),
  );
  const source = found ? sources.join("+") : "contact_miss";

  const raw = { provenance, foundAt: new Date().toISOString() };
  await db.listingContact.upsert({
    where: { listingMlsId: listing.mlsId },
    create: {
      listingMlsId: listing.mlsId,
      source,
      ...merged,
      raw,
      fetchedAt: new Date(),
    },
    update: {
      source,
      ...merged,
      raw,
      fetchedAt: new Date(),
    },
  });

  return found ? { status: "hit", source } : { status: "miss" };
}
