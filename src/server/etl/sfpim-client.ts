/**
 * SF Assessor Secured Property Tax Roll — Socrata client.
 *
 * Dataset: wv5m-vpq2 (https://data.sfgov.org/Housing-and-Buildings/Assessor-Historical-Secured-Property-Tax-Rolls/wv5m-vpq2)
 * The Assessor's official per-parcel record: building area, parcel area,
 * year built, stories, units, rooms, beds, baths, basement area, use type.
 * Used by `scripts/enrich-sfpim.ts` to fill in the holes in the Bridge feed.
 *
 * Note: the file is named "sfpim" for historical reasons. The original
 * `i8ew-h6z7` dataset is an `href`/link asset, not a tabular table, and
 * returns "no row or column access to non-tabular tables" on any query.
 *
 * Rows are partitioned by `closed_roll_year`; we always order DESC and take
 * the first match per parcel so callers see the latest assessment.
 *
 * Anonymous access (no X-App-Token). Throttled to ~1 req/sec to stay polite
 * within Socrata's anonymous-access guidance.
 */

import { type AddressParts, parseAddress } from "./address-parser";
import { MIN_SCORE, rangeNumbers, scoreCandidate } from "./sfpim-scoring";
import {
  type AssessorRecord,
  type MatchedAssessor,
  type SfpimRow,
  mapSfpimRow,
} from "./sfpim-types";

export { mapSfpimRow, type AssessorRecord, type MatchedAssessor, type SfpimRow };
export { normalizeSuffix, parseAddress, type AddressParts } from "./address-parser";
export { scoreCandidate } from "./sfpim-scoring";

const BASE_URL = "https://data.sfgov.org/resource/wv5m-vpq2.json";
const THROTTLE_MS = 1100;

let lastRequestAt = 0;

async function throttle() {
  const now = Date.now();
  const wait = Math.max(0, lastRequestAt + THROTTLE_MS - now);
  lastRequestAt = now + wait;
  if (wait > 0) await new Promise((r) => setTimeout(r, wait));
}

async function fetchJson(url: string): Promise<SfpimRow[]> {
  await throttle();
  const res = await fetch(url, { headers: { Accept: "application/json" } });
  if (!res.ok) {
    throw new Error(`SFPIM ${res.status} ${res.statusText}: ${await res.text()}`);
  }
  return (await res.json()) as SfpimRow[];
}

/**
 * Look up by canonical APN ("0216013"). The dataset has one row per
 * `closed_roll_year`; we order DESC so callers get the latest assessment.
 */
export async function getByBlockLot(blockLot: string): Promise<AssessorRecord | null> {
  const params = new URLSearchParams({
    parcel_number: blockLot,
    $order: "closed_roll_year DESC",
    $limit: "1",
  });
  const rows = await fetchJson(`${BASE_URL}?${params.toString()}`);
  const row = rows[0];
  return row ? mapSfpimRow(row) : null;
}

/**
 * Address-based match against the SF Assessor roll. Returns the best
 * candidate above the confidence floor or `null` (callers should leave
 * assessor fields blank rather than attach a guess).
 *
 * Two-layer strategy:
 *   1. SoQL `like '%<padded-num> <NAME>%'` — leverages the dataset's
 *      fixed-width "0067 HAIGHT" encoding to cheaply cut the candidate set
 *      server-side.
 *   2. JS-side strict regex + score — handles range encodings, suffix
 *      verification, and (for condos) prefers the unit-sized parcel over
 *      the parent-building parcel by sqft proximity.
 */
export async function searchByParts(parts: AddressParts): Promise<MatchedAssessor | null> {
  const numbers = rangeNumbers(parts.streetNumber);
  if (numbers.length === 0 || !parts.streetName) return null;

  // Use the lower endpoint for the SoQL query — the assessor encodes ranges
  // as "<high> <low> NAME", so `like '%<low> NAME%'` finds both single and
  // range parcels.
  const lowNum = numbers[0]!;
  // SoQL strings escape ' as ''. Names like "O'FARRELL" need this.
  const soqlName = parts.streetName.replace(/'/g, "''");
  const where = `upper(property_location) like '%${lowNum} ${soqlName}%'`;
  const params = new URLSearchParams({
    $where: where,
    $order: "closed_roll_year DESC",
    $limit: "50",
  });
  const rows = await fetchJson(`${BASE_URL}?${params.toString()}`);
  if (rows.length === 0) return null;

  // Dedupe to latest year per parcel.
  const byParcel = new Map<string, SfpimRow>();
  for (const r of rows) {
    const key = r.parcel_number ?? "";
    if (key && !byParcel.has(key)) byParcel.set(key, r);
  }

  type Scored = { row: SfpimRow; score: number; reasons: string[] };
  const scored: Scored[] = [];
  for (const row of byParcel.values()) {
    const s = scoreCandidate(row, parts);
    if (s) scored.push({ row, score: s.score, reasons: s.reasons });
  }
  if (scored.length === 0) return null;

  scored.sort(
    (a, b) =>
      b.score - a.score ||
      (a.row.property_location?.length ?? Infinity) -
        (b.row.property_location?.length ?? Infinity),
  );
  const best = scored[0]!;
  if (best.score < MIN_SCORE) return null;
  return { record: mapSfpimRow(best.row), score: best.score, reasons: best.reasons };
}

/**
 * Address-string convenience wrapper. Prefer `searchByParts` when callers
 * have access to Bridge's `StreetNumber`/`StreetName` (cleaner than parsing
 * the assembled address string).
 */
export async function searchByAddress(address: string): Promise<AssessorRecord | null> {
  const parsed = parseAddress(address);
  if (!parsed) return null;
  const m = await searchByParts({
    streetNumber: parsed.streetNumber,
    streetName: parsed.streetName,
    streetSuffix: parsed.streetSuffix,
    unitNumber: parsed.unitNumber,
    postalCode: parsed.postalCode,
    listingSqft: null,
    listingUnits: null,
  });
  return m?.record ?? null;
}
