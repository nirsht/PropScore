/**
 * SF Soft Story Properties — Socrata client.
 *
 * Dataset: beah-shgi — the tabular "Soft-Story Properties" view that backs
 * the public map at jwdp-cqyc. Socrata flipped jwdp-cqyc to a map-only
 * visualization, which rejects column projections; beah-shgi is the same
 * data with the original SoQL surface.
 *
 * One row per parcel on SF DBI's mandatory soft-story retrofit program. The
 * dataset is small + finite (~5k rows total across SF), so we fetch the whole
 * thing once per enrichment run and bulk-tag listings — much cheaper than the
 * per-parcel pattern used by code-enforcement-client.ts.
 *
 * Joined to `Listing.blockLot` via the dataset's `block` + `lot` columns
 * (zero-padded then concatenated by `canonicalBlockLot`).
 *
 * Anonymous Socrata access; one page covers the whole dataset in practice
 * but we paginate defensively in case the program list grows.
 */

import { canonicalBlockLot } from "./permits-client";

const BASE_URL = "https://data.sfgov.org/resource/beah-shgi.json";
const PAGE_SIZE = 10000;
const THROTTLE_MS = 1100;

let lastRequestAt = 0;

async function throttle() {
  const now = Date.now();
  const wait = Math.max(0, lastRequestAt + THROTTLE_MS - now);
  lastRequestAt = now + wait;
  if (wait > 0) await new Promise((r) => setTimeout(r, wait));
}

export type SoftStoryRow = {
  block?: string;
  lot?: string;
  parcel_number?: string;
  status?: string;
  tier?: string;
  property_address?: string;
  bos_district?: string;
  [k: string]: unknown;
};

export type SoftStoryRecord = {
  blockLot: string;
  /// Raw dataset status verbatim — surfaced in the drawer tooltip.
  status: string | null;
  /// 1–4. Null if the dataset omits it for this row.
  tier: number | null;
  /// True when status indicates retrofit is complete (or the parcel is
  /// formally exempt). The Listing-level red-flag column is the negation of
  /// this for parcels found in the dataset.
  retrofitted: boolean;
};

// Status values that indicate the retrofit obligation has been satisfied —
// either the work is done and signed off (CFC), an engineer's compliance
// opinion is on file (CEO), the owner has submitted the compliance form
// (CFS), the parcel was formally exempted, or the building has been
// demolished/removed from inventory. Anything outside this set reads as an
// outstanding red flag.
const RETROFITTED_STATUSES = new Set<string>([
  "work complete - cfc issued",
  "compliant engineer opinion (ceo)",
  "compliant form submitted (cfs)",
  "exempt",
  "exempt - demolished",
  "exempt - non-compliant; deemed not subject to ordinance",
  "no work required",
]);

function str(v: unknown): string | null {
  if (typeof v !== "string") return null;
  const t = v.trim();
  return t.length > 0 ? t : null;
}

function parseTier(v: unknown): number | null {
  const s = str(v);
  if (!s) return null;
  // Dataset tiers are emitted as "1".."4" or sometimes "Tier 2"; pull the digit.
  const m = s.match(/[1-4]/);
  if (!m) return null;
  return Number(m[0]);
}

function isRetrofitted(status: string | null): boolean {
  if (!status) return false;
  return RETROFITTED_STATUSES.has(status.toLowerCase().trim());
}

async function fetchPage(offset: number): Promise<SoftStoryRow[]> {
  await throttle();
  const params = new URLSearchParams({
    $select: "block,lot,parcel_number,status,tier,property_address",
    $limit: String(PAGE_SIZE),
    $offset: String(offset),
  });
  const res = await fetch(`${BASE_URL}?${params.toString()}`, {
    headers: { Accept: "application/json" },
  });
  if (!res.ok) {
    throw new Error(
      `Soft-story ${res.status} ${res.statusText}: ${(await res.text()).slice(0, 500)}`,
    );
  }
  return (await res.json()) as SoftStoryRow[];
}

/**
 * Fetch the entire SF soft-story list and return a Map keyed by canonical
 * `blockLot` (4-char block + 3-char lot) so callers can join in O(1).
 *
 * When a parcel appears more than once in the dataset (rare — typically
 * because of historical reclassification), the most recently-fetched row
 * wins. Status casing is preserved verbatim from the source so it can be
 * shown to the user in the tooltip.
 */
export async function fetchAllSoftStoryRecords(): Promise<
  Map<string, SoftStoryRecord>
> {
  const byBlockLot = new Map<string, SoftStoryRecord>();
  let offset = 0;
  // Defensive cap — the dataset is ~5k rows; if a fetch loop runs past 50k
  // something is wrong.
  const MAX_ROWS = 50_000;

  for (;;) {
    const rows = await fetchPage(offset);
    if (rows.length === 0) break;

    for (const row of rows) {
      const block = str(row.block);
      const lot = str(row.lot);
      if (!block || !lot) continue;
      const blockLot = canonicalBlockLot(block, lot);
      const status = str(row.status);
      byBlockLot.set(blockLot, {
        blockLot,
        status,
        tier: parseTier(row.tier),
        retrofitted: isRetrofitted(status),
      });
    }

    offset += rows.length;
    if (rows.length < PAGE_SIZE || offset >= MAX_ROWS) break;
  }

  return byBlockLot;
}
