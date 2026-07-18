import { db } from "@/lib/db";
import { lookupAgentContact } from "@/server/etl/apollo-client";
import { fetchMember, type BridgeMember } from "@/server/etl/bridge-client";
import {
  findContactViaAgent,
  type ContactGrounding,
} from "@/server/agents/contact-finder/agent";
import { extractBridgeAgentFields } from "@/server/agents/chat-asset/prompt";

/**
 * Contact enrichment — resolves the listing agent's phone + email through an
 * ordered fallback chain, merging what each source can supply:
 *
 *   1. bridge        — phone/email already on the listing's synced Bridge `raw`
 *                      Property payload (free; `sfar` IDX strips these, so this
 *                      almost always yields names only).
 *   2. bridge_member — the agent's own Bridge `/Member` record, looked up by
 *                      the listing's agent id (ListAgentKey/ListAgentMlsId).
 *                      Authoritative: the Member resource carries the real
 *                      phone/email even under IDX, matched on id so there's no
 *                      name-collision risk. Primary source for MLS agents.
 *   3. apollo        — Apollo People-Match by agent name + brokerage
 *                      (email-only; for agents not in the SFAR Member table).
 *   4. agent_llm     — last-resort headless LLM contact-finder (web_search).
 *                      Only runs when the id-keyed sources miss, and its result
 *                      is rejected unless the name matches the listing agent —
 *                      a web search for a common name must not attach a
 *                      different same-named agent's phone.
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
const SOURCE_ORDER = ["bridge", "bridge_member", "apollo", "agent_llm"] as const;
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

/** The listing agent's Bridge id(s), used to look up their Member record. */
function bridgeAgentKeys(raw: unknown): {
  memberKey: string | null;
  memberMlsId: string | null;
} {
  const r = (raw ?? {}) as Record<string, unknown>;
  return {
    memberKey: str(r.ListAgentKey),
    memberMlsId: str(r.ListAgentMlsId),
  };
}

/**
 * Best contact phone off a Member record. Prefer a mobile/direct line, then
 * the MLS "preferred" number, then the office line. The SFAR extension only
 * applies to the office landline, so append it only when the chosen number is
 * that office line.
 */
function memberPhone(m: BridgeMember): string | null {
  const office = str(m.MemberOfficePhone);
  const phone =
    str(m.MemberMobilePhone) ??
    str(m.MemberDirectPhone) ??
    str(m.MemberPreferredPhone) ??
    office;
  if (!phone) return null;
  const ext = str(m.SFAR_PhoneExtension);
  return ext && phone === office ? `${phone} x${ext}` : phone;
}

/** Step 2 — map an authoritative Bridge Member record into contact fields. */
function fromMember(m: BridgeMember): Partial<ContactFields> {
  return {
    agentName: str(m.MemberFullName),
    agentPhone: memberPhone(m),
    agentEmail: str(m.MemberEmail),
    officeName: str(m.OfficeName),
    officePhone: str(m.MemberOfficePhone),
  };
}

/** Normalize a name for comparison: lowercase, drop punctuation, collapse ws. */
function normName(n: string | null): string {
  return (n ?? "")
    .toLowerCase()
    .replace(/[^a-z\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * True if `candidate` plausibly names the same person as the Bridge listing
 * agent — same last name and same first initial. Guards the web/Apollo steps
 * from attaching a *different* same-first-name agent's phone/email (the class
 * of bug where "George Johnson" resolved to a prominent "George Limperis").
 *
 * Deliberately conservative: when we have no Bridge name to check against, or
 * the candidate has no name, we can't verify and allow it (the id/grounding
 * already scoped the lookup). A last-name or first-initial mismatch is a hard
 * reject — better to fall through to the next source than persist a stranger.
 */
function nameMatchesAgent(
  candidate: string | null,
  agentName: string | null,
): boolean {
  const a = normName(agentName);
  const c = normName(candidate);
  if (!a || !c) return true;
  const aParts = a.split(" ");
  const cParts = c.split(" ");
  const aLast = aParts[aParts.length - 1];
  const cLast = cParts[cParts.length - 1];
  if (aLast !== cLast) return false;
  return (aParts[0]?.[0] ?? "") === (cParts[0]?.[0] ?? "");
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

  // The listing agent's name per Bridge — the identity the id-less fallback
  // sources (Apollo, LLM) must match before we trust their phone/email.
  const bridgeAgentName = str(
    (listing.raw as Record<string, unknown> | null)?.ListAgentFullName,
  );

  try {
    // 1. Bridge Property raw (free — already-synced fields; usually names only).
    fillFrom(merged, provenance, "bridge", fromBridge(listing.raw));

    // 2. Bridge Member — authoritative agent contact, keyed on the listing's
    //    agent id, so there's no name-collision risk.
    if (!hasBoth(merged)) {
      const { memberKey, memberMlsId } = bridgeAgentKeys(listing.raw);
      if (memberKey || memberMlsId) {
        const member = await fetchMember({ memberKey, memberMlsId });
        if (member) {
          fillFrom(merged, provenance, "bridge_member", fromMember(member));
        }
      }
    }

    // 3. Apollo (email-only) — only if we still lack phone or email. Reject the
    //    match when its name doesn't line up with the Bridge listing agent.
    if (!hasBoth(merged)) {
      const { firstName, lastName } = splitName(merged.agentName);
      const apollo = await lookupAgentContact({
        firstName,
        lastName,
        organizationName: merged.officeName,
      });
      if (apollo && nameMatchesAgent(apollo.agentName, bridgeAgentName)) {
        fillFrom(merged, provenance, "apollo", {
          agentName: apollo.agentName,
          agentPhone: apollo.agentPhone,
          agentEmail: apollo.agentEmail,
          officeName: apollo.officeName,
          officePhone: apollo.officePhone,
        });
      } else if (apollo) {
        // eslint-disable-next-line no-console
        console.warn(
          `[contacts] mlsId=${listing.mlsId} apollo name mismatch: "${apollo.agentName}" vs bridge "${bridgeAgentName}" — rejected`,
        );
      }
    }

    // 4. LLM contact-finder (last resort) — only when the id-keyed sources
    //    missed. Same name guard: a web search for a common name must not
    //    attach a different same-named agent's phone/email.
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
      if (llm && nameMatchesAgent(str(llm.agentName), bridgeAgentName)) {
        fillFrom(merged, provenance, "agent_llm", {
          agentName: str(llm.agentName),
          agentPhone: str(llm.agentPhone),
          agentEmail: str(llm.agentEmail),
          officeName: str(llm.officeName),
          officePhone: str(llm.officePhone),
          officeEmail: str(llm.officeEmail),
        });
      } else if (llm) {
        // eslint-disable-next-line no-console
        console.warn(
          `[contacts] mlsId=${listing.mlsId} agent_llm name mismatch: "${str(llm.agentName)}" vs bridge "${bridgeAgentName}" — rejected`,
        );
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
