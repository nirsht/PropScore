/**
 * SF Property Information Map (SFPIM) — Socrata client.
 *
 * Dataset: i8ew-h6z7 (https://data.sfgov.org/Housing-and-Buildings/SF-PIM/i8ew-h6z7)
 * The Assessor's official record per parcel: building area, parcel area,
 * year built, stories, units, rooms, beds, baths, basement, use type. Used
 * by `scripts/enrich-sfpim.ts` to fill in the holes in the Bridge MLS feed.
 *
 * Anonymous access (no X-App-Token). Throttled to ~1 req/sec to stay polite
 * within Socrata's anonymous-access guidance.
 */

const BASE_URL = "https://data.sfgov.org/resource/i8ew-h6z7.json";
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
  blklot?: string;
  block?: string;
  lot?: string;
  property_location?: string;
  bldg_sqft?: string;
  lot_area?: string;
  year_built?: string;
  num_stories?: string;
  num_units?: string;
  num_rooms?: string;
  num_bedrooms?: string;
  num_bathrooms?: string;
  use_code?: string;
  use_definition?: string;
  construction_type?: string;
  basement?: string;
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
  return {
    blockLot: str(row.blklot),
    block: str(row.block),
    lot: str(row.lot),
    propertyLocation: str(row.property_location),
    buildingSqft: positiveInt(row.bldg_sqft),
    lotSqft: positiveInt(row.lot_area),
    yearBuilt: positiveInt(row.year_built),
    stories: positiveInt(row.num_stories),
    units: positiveInt(row.num_units),
    rooms: positiveInt(row.num_rooms),
    bedrooms: positiveInt(row.num_bedrooms),
    bathrooms: positiveNum(row.num_bathrooms),
    useType: str(row.use_definition) ?? str(row.use_code),
    constructionType: str(row.construction_type),
    basement: str(row.basement),
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
 * Look up by canonical APN ("0216013"). One row expected.
 */
export async function getByBlockLot(blockLot: string): Promise<AssessorRecord | null> {
  const params = new URLSearchParams({ blklot: blockLot, $limit: "1" });
  const rows = await fetchJson(`${BASE_URL}?${params.toString()}`);
  const row = rows[0];
  return row ? mapSfpimRow(row) : null;
}

/**
 * Best-effort address match. Bridge addresses often arrive as "1480 Clay St"
 * or "1480-1490 Clay St" (range). The Assessor stores `property_location`
 * uppercased, e.g. "1480 CLAY ST". We match on the lowest house number +
 * street name fragment so range listings still match.
 */
export async function searchByAddress(address: string): Promise<AssessorRecord | null> {
  const parsed = parseAddress(address);
  if (!parsed) return null;

  // SoQL: upper(property_location) like '1480 CLAY%' — use the leading
  // house number so listings without a unit suffix still match. Cap at 5
  // so we can pick the smallest building-sqft match if needed.
  const where = `upper(property_location) like '${parsed.streetNumber} ${parsed.streetName.toUpperCase()}%'`;
  const params = new URLSearchParams({ $where: where, $limit: "5" });
  const rows = await fetchJson(`${BASE_URL}?${params.toString()}`);
  if (rows.length === 0) return null;

  // Prefer the row whose property_location starts exactly with the parsed
  // number+street to avoid 1480 vs 14800 collisions.
  const exactPrefix = `${parsed.streetNumber} ${parsed.streetName.toUpperCase()}`;
  const exact = rows.find(
    (r) => (r.property_location ?? "").toUpperCase().startsWith(exactPrefix),
  );
  return mapSfpimRow(exact ?? rows[0]!);
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
