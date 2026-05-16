import { db } from "@/lib/db";
import {
  lookupSaleListingByAddress,
  type RentCastSaleListing,
} from "@/server/etl/rentcast-client";

/**
 * Refresh policy. Hits get re-checked every 30 days (catches agent moves);
 * misses get retried after 30 days too — RentCast may not have indexed the
 * address yet at first attempt. Both knobs are tuned to keep monthly call
 * volume well within the Foundation tier (1k req/mo) for ~hundreds of SF
 * listings.
 */
const HIT_REFRESH_MS = 30 * 24 * 60 * 60 * 1000;
const MISS_REFRESH_MS = 30 * 24 * 60 * 60 * 1000;

export type EnrichResult =
  | { status: "skipped"; reason: "fresh" | "no-key" | "no-address" }
  | { status: "hit" }
  | { status: "miss" }
  | { status: "error"; error: string };

type ListingForEnrichment = {
  mlsId: string;
  address: string;
  city: string | null;
  state: string | null;
  postalCode: string | null;
};

function buildAddressQuery(l: ListingForEnrichment): string {
  return [l.address, l.city, l.state, l.postalCode]
    .filter((p): p is string => Boolean(p && p.trim()))
    .join(", ");
}

function mapContact(listing: RentCastSaleListing) {
  const a = listing.listingAgent ?? {};
  const o = listing.listingOffice ?? {};
  return {
    agentName: a.name ?? null,
    agentPhone: a.phone ?? null,
    agentEmail: a.email ?? null,
    agentWebsite: a.website ?? null,
    officeName: o.name ?? null,
    officePhone: o.phone ?? null,
    officeEmail: o.email ?? null,
    officeWebsite: o.website ?? null,
  };
}

/**
 * Idempotent. Enriches a single Listing's contact row from RentCast.
 *   - Short-circuits if the existing row is younger than the refresh window.
 *   - Records a `rentcast_miss` row when RentCast has no match, so we don't
 *     retry on every nightly run.
 *   - Never throws on RentCast failure — logs and returns `error` so the
 *     ETL pipeline keeps moving.
 */
export async function enrichListingContact(
  listing: ListingForEnrichment,
  opts: { force?: boolean } = {},
): Promise<EnrichResult> {
  if (!process.env.RENTCAST_API_KEY) {
    return { status: "skipped", reason: "no-key" };
  }
  const query = buildAddressQuery(listing);
  if (!query) return { status: "skipped", reason: "no-address" };

  if (!opts.force) {
    const existing = await db.listingContact.findUnique({
      where: { listingMlsId: listing.mlsId },
      select: { fetchedAt: true, source: true },
    });
    if (existing) {
      const age = Date.now() - existing.fetchedAt.getTime();
      const window =
        existing.source === "rentcast_miss" ? MISS_REFRESH_MS : HIT_REFRESH_MS;
      if (age < window) return { status: "skipped", reason: "fresh" };
    }
  }

  let hit: RentCastSaleListing | null;
  try {
    hit = await lookupSaleListingByAddress(query);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    // eslint-disable-next-line no-console
    console.warn(`[contacts] mlsId=${listing.mlsId} rentcast error: ${message}`);
    return { status: "error", error: message };
  }

  if (!hit) {
    await db.listingContact.upsert({
      where: { listingMlsId: listing.mlsId },
      create: {
        listingMlsId: listing.mlsId,
        source: "rentcast_miss",
        fetchedAt: new Date(),
      },
      update: {
        source: "rentcast_miss",
        fetchedAt: new Date(),
        agentName: null,
        agentPhone: null,
        agentEmail: null,
        agentWebsite: null,
        officeName: null,
        officePhone: null,
        officeEmail: null,
        officeWebsite: null,
        raw: undefined,
      },
    });
    return { status: "miss" };
  }

  const mapped = mapContact(hit);
  await db.listingContact.upsert({
    where: { listingMlsId: listing.mlsId },
    create: {
      listingMlsId: listing.mlsId,
      source: "rentcast",
      ...mapped,
      raw: hit as object,
      fetchedAt: new Date(),
    },
    update: {
      source: "rentcast",
      ...mapped,
      raw: hit as object,
      fetchedAt: new Date(),
    },
  });
  return { status: "hit" };
}
