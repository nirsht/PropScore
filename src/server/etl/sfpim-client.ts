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

const BASE_URL = "https://data.sfgov.org/resource/wv5m-vpq2.json";
const THROTTLE_MS = 1100;

let lastRequestAt = 0;

async function throttle() {
  const now = Date.now();
  const wait = Math.max(0, lastRequestAt + THROTTLE_MS - now);
  lastRequestAt = now + wait;
  if (wait > 0) await new Promise((r) => setTimeout(r, wait));
}

/**
 * Raw row shape — we only declare the columns we read. Socrata returns all
 * values as strings, so callers must coerce via the helpers below.
 */
export type SfpimRow = {
  parcel_number?: string;
  block?: string;
  lot?: string;
  property_location?: string;
  property_area?: string;
  lot_area?: string;
  year_property_built?: string;
  number_of_stories?: string;
  number_of_units?: string;
  number_of_rooms?: string;
  number_of_bedrooms?: string;
  number_of_bathrooms?: string;
  use_code?: string;
  use_definition?: string;
  construction_type?: string;
  basement_area?: string;
  closed_roll_year?: string;
  closed_roll_assessed_improvement_value?: string;
  closed_roll_assessed_land_value?: string;
  [k: string]: string | undefined;
};

export type AssessorRecord = {
  blockLot: string | null;
  block: string | null;
  lot: string | null;
  propertyLocation: string | null;
  buildingSqft: number | null;
  lotSqft: number | null;
  yearBuilt: number | null;
  stories: number | null;
  units: number | null;
  rooms: number | null;
  bedrooms: number | null;
  bathrooms: number | null;
  useType: string | null;
  constructionType: string | null;
  basement: string | null;
  buildingValue: number | null;
  landValue: number | null;
  raw: SfpimRow;
};

const num = (v: string | undefined): number | null => {
  if (v == null || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};

const int = (v: string | undefined): number | null => {
  const n = num(v);
  return n == null ? null : Math.round(n);
};

const positiveInt = (v: string | undefined): number | null => {
  const n = int(v);
  return n != null && n > 0 ? n : null;
};

const positiveNum = (v: string | undefined): number | null => {
  const n = num(v);
  return n != null && n > 0 ? n : null;
};

const str = (v: string | undefined): string | null => {
  if (v == null) return null;
  const trimmed = v.trim();
  return trimmed.length > 0 ? trimmed : null;
};

export function mapSfpimRow(row: SfpimRow): AssessorRecord {
  const basementSqft = positiveInt(row.basement_area);
  return {
    blockLot: str(row.parcel_number),
    block: str(row.block),
    lot: str(row.lot),
    propertyLocation: str(row.property_location),
    buildingSqft: positiveInt(row.property_area),
    lotSqft: positiveInt(row.lot_area),
    yearBuilt: positiveInt(row.year_property_built),
    stories: positiveInt(row.number_of_stories),
    units: positiveInt(row.number_of_units),
    rooms: positiveInt(row.number_of_rooms),
    bedrooms: positiveInt(row.number_of_bedrooms),
    bathrooms: positiveNum(row.number_of_bathrooms),
    useType: str(row.use_definition) ?? str(row.use_code),
    constructionType: str(row.construction_type),
    basement: basementSqft != null ? `${basementSqft} sqft` : null,
    buildingValue: positiveInt(row.closed_roll_assessed_improvement_value),
    landValue: positiveInt(row.closed_roll_assessed_land_value),
    raw: row,
  };
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
 * Best-effort address match. Bridge addresses often arrive as "1480 Clay St"
 * or "1480-1490 Clay St" (range). The Assessor stores `property_location`
 * with quirky padding/range encoding, e.g. "1490 1480 CLAY                ST0000",
 * so we use a contains-match on "<num> <street>" and post-filter with a
 * whitespace-normalized token check.
 */
export async function searchByAddress(address: string): Promise<AssessorRecord | null> {
  const parsed = parseAddress(address);
  if (!parsed) return null;

  // SoQL: upper(property_location) like '%1480 CLAY%'. Contains-match handles
  // the high-then-low range encoding ("1490 1480 CLAY ST"). Order by year
  // DESC and pull more rows than we need so we can dedupe to the latest year
  // per parcel after the fact.
  const token = `${parsed.streetNumber} ${parsed.streetName.toUpperCase()}`;
  const where = `upper(property_location) like '%${token}%'`;
  const params = new URLSearchParams({
    $where: where,
    $order: "closed_roll_year DESC",
    $limit: "25",
  });
  const rows = await fetchJson(`${BASE_URL}?${params.toString()}`);
  if (rows.length === 0) return null;

  // Dedupe by parcel_number, keeping first occurrence (latest year).
  const byParcel = new Map<string, SfpimRow>();
  for (const r of rows) {
    const key = r.parcel_number ?? "";
    if (key && !byParcel.has(key)) byParcel.set(key, r);
  }
  const candidates = [...byParcel.values()];

  // Post-filter: prefer rows whose normalized property_location contains the
  // exact "<num> <street>" token; among those, prefer the shortest location
  // string (single-parcel rows over range encodings) to avoid 1480 vs 14800
  // collisions. Fall back to the first candidate if no token match.
  const matching = candidates.filter((r) =>
    (r.property_location ?? "").toUpperCase().replace(/\s+/g, " ").includes(token),
  );
  const pool = matching.length > 0 ? matching : candidates;
  pool.sort(
    (a, b) => (a.property_location?.length ?? 0) - (b.property_location?.length ?? 0),
  );
  return mapSfpimRow(pool[0]!);
}

/**
 * Normalize Bridge-style address into a leading number + street name.
 *
 * Examples:
 *   "1480-1490 Clay St"          → { streetNumber: "1480", streetName: "Clay" }
 *   "1480 Clay Street, Apt 3"    → { streetNumber: "1480", streetName: "Clay" }
 *   "1480 Clay"                  → { streetNumber: "1480", streetName: "Clay" }
 */
export function parseAddress(
  address: string,
): { streetNumber: string; streetName: string } | null {
  const cleaned = address.trim().toUpperCase().replace(/\s+/g, " ");
  // Strip ", APT 3" / ", #3" / ", UNIT 3" tail (we're matching the building,
  // not a specific unit).
  const noUnit = cleaned.replace(/,?\s*(APT|UNIT|STE|SUITE|#)\s*[\w-]+.*$/i, "");

  const match = noUnit.match(/^(\d+)(?:[-\s]\d+)?\s+([A-Z0-9][A-Z0-9 .'-]*?)(?:\s+(ST|STREET|AVE|AVENUE|BLVD|BOULEVARD|RD|ROAD|DR|DRIVE|CT|COURT|PL|PLACE|WAY|TER|TERRACE|LN|LANE)\b.*)?$/);
  if (!match) return null;

  const streetNumber = match[1]!;
  const streetName = match[2]!.trim();
  if (!streetName) return null;
  return { streetNumber, streetName };
}
