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

export type MatchedAssessor = {
  record: AssessorRecord;
  score: number;
  reasons: string[];
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
 * Parsed listing address. The Bridge feed gives us `StreetNumber` and
 * `StreetName` cleanly, but never `StreetSuffix` or `UnitNumber`, so callers
 * typically combine Bridge components with `parseAddress` of the raw
 * `UnparsedAddress` for the suffix.
 */
export type AddressParts = {
  /** "67", or "1480-1490" for range parcels. */
  streetNumber: string;
  /** "HAIGHT", "9TH" — already uppercased by `parseAddress`. */
  streetName: string;
  /** Normalized 2-letter suffix (ST/AV/WY/...) or null. */
  streetSuffix: string | null;
  /** Marketed unit number (e.g. "54J"). Not used for matching — assessor's
   * sub-parcel encoding doesn't reliably correspond. Kept for observability. */
  unitNumber: string | null;
  postalCode: string | null;
  /** Listing's reported sqft, used as a tie-breaker (favors picking the
   * condo unit over the parent building parcel in towers). */
  listingSqft: number | null;
  /** Listing's reported unit count, used as a tie-breaker for multi-family. */
  listingUnits: number | null;
};

/**
 * Maps the various suffix spellings we see in Bridge / user addresses to
 * the 2-letter codes the assessor dataset uses in the fixed-width tail of
 * `property_location` (e.g., "...HAIGHT ST0000", "...RETIRO WY0000").
 */
const SUFFIX_MAP: Record<string, string> = {
  ST: "ST", STREET: "ST",
  AV: "AV", AVE: "AV", AVENUE: "AV",
  BL: "BL", BLVD: "BL", BOULEVARD: "BL",
  DR: "DR", DRIVE: "DR",
  RD: "RD", ROAD: "RD",
  WY: "WY", WAY: "WY",
  LN: "LN", LANE: "LN",
  PL: "PL", PLACE: "PL",
  CT: "CT", COURT: "CT",
  TR: "TR", TER: "TR", TERRACE: "TR",
  HY: "HY", HWY: "HY", HIGHWAY: "HY",
  CR: "CR", CIR: "CR", CIRCLE: "CR",
  PK: "PK", PARK: "PK",
  AL: "AL", ALY: "AL", ALLEY: "AL",
  PY: "PY", PKWY: "PY", PARKWAY: "PY",
  RW: "RW", ROW: "RW",
};

export function normalizeSuffix(s: string | null | undefined): string | null {
  if (!s) return null;
  const key = s.trim().toUpperCase().replace(/\./g, "");
  return SUFFIX_MAP[key] ?? null;
}

const SUFFIX_REGEX_GROUP =
  "ST|STREET|AVE?|AVENUE|BLVD?|BOULEVARD|RD|ROAD|DR|DRIVE|CT|COURT|" +
  "PL|PLACE|WY|WAY|TER|TERRACE|LN|LANE|HY|HWY|HIGHWAY|CR|CIR|CIRCLE|" +
  "PK|PARK|AL|ALY|ALLEY|PY|PKWY|PARKWAY|RW|ROW";

/**
 * Normalize Bridge-style address into number / name / suffix / unit / zip.
 *
 * Examples:
 *   "1480-1490 Clay St"                        → { number: "1480-1490", name: "CLAY", suffix: "ST" }
 *   "67 Haight Street, San Francisco CA 94102" → { ..., zip: "94102" }
 *   "181 Fremont Street # 54J, San Francisco CA 94105" → { ..., unit: "54J" }
 */
export function parseAddress(address: string): {
  streetNumber: string;
  streetName: string;
  streetSuffix: string | null;
  unitNumber: string | null;
  postalCode: string | null;
} | null {
  const cleaned = address.trim().toUpperCase().replace(/\s+/g, " ");
  const zipMatch = cleaned.match(/\b(\d{5})(?:-\d{4})?\b\s*$/);
  const postalCode = zipMatch ? zipMatch[1]! : null;

  // Unit can appear before OR after the city/state/zip in Bridge's assembled
  // address ("181 Fremont Street # 54J, San Francisco CA 94105" vs.
  // "1480 Clay St, Apt 3"). Look in the whole cleaned string.
  const unitMatch = cleaned.match(/(?:^|[,\s])(?:APT|UNIT|STE|SUITE|#)\s*([A-Z0-9-]+)/);
  const unitNumber = unitMatch ? unitMatch[1]! : null;
  const unitIdx = unitMatch?.index ?? -1;
  const noUnit =
    unitMatch && unitIdx >= 0
      ? (cleaned.slice(0, unitIdx) + cleaned.slice(unitIdx + unitMatch[0].length))
          .replace(/\s+/g, " ")
          .trim()
      : cleaned;

  // Strip the ", SF, CA ZIP" tail before parsing components — comma-delimited.
  const beforeComma = noUnit.split(",")[0]!.trim();

  const re = new RegExp(
    `^(\\d+(?:-\\d+)?)\\s+([A-Z0-9][A-Z0-9 .'\\-]*?)(?:\\s+(${SUFFIX_REGEX_GROUP})\\b\\.?)?$`,
  );
  const match = beforeComma.match(re);
  if (!match) return null;

  const streetNumber = match[1]!;
  const streetName = match[2]!.trim();
  if (!streetName) return null;
  const streetSuffix = normalizeSuffix(match[3]);
  return { streetNumber, streetName, streetSuffix, unitNumber, postalCode };
}

function zeroPad(n: string, width = 4): string {
  return n.length >= width ? n : "0".repeat(width - n.length) + n;
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Build the list of zero-padded street numbers to look for. For range
 * parcels Bridge passes "1306-1308" — we want to match either endpoint in
 * the assessor's location string (which itself encodes ranges as
 * "1308 1306 GUERRERO").
 */
function rangeNumbers(streetNumber: string): string[] {
  const parts = streetNumber.split("-");
  const out = new Set<string>();
  for (const p of parts) {
    const trimmed = p.trim();
    if (/^\d+$/.test(trimmed)) out.add(zeroPad(trimmed));
  }
  return [...out];
}

const MIN_SCORE = 60;

/**
 * Score a single assessor row against the listing's parsed components.
 *
 * Hard requirements (returns null otherwise):
 *   - Zero-padded street number bounded by space/edge in `property_location`
 *     (no substring leakage: "67 HAIGHT" must not match "167 HAIGHT" or "1067 HAIGHT").
 *   - Street name appears as a whole token immediately after the number
 *     (or after the range second-number), so "OAK" can't match "OAKDALE".
 *
 * Score (additive, max 100):
 *   60 base for passing both hard requirements
 *   +15 if the assessor suffix tail matches (ST/AV/WY/…)
 *   +15 if assessor building sqft is within 0.5x..2x of the listing sqft
 *   +10 if assessor unit count is within ±1 of the listing's
 */
export function scoreCandidate(
  row: SfpimRow,
  parts: AddressParts,
): { score: number; reasons: string[] } | null {
  const loc = (row.property_location ?? "").toUpperCase().replace(/\s+/g, " ").trim();
  if (!loc) return null;

  const numbers = rangeNumbers(parts.streetNumber);
  if (numbers.length === 0) return null;

  // Dataset encodes single parcels as "0067 HAIGHT" and range parcels as
  // "0070 0067 HAIGHT". The number must appear bounded; allow an optional
  // second 4-5 digit number between number and name for ranges.
  const numAlternation = numbers.map(escapeRegex).join("|");
  const escapedName = escapeRegex(parts.streetName);
  const namePattern = new RegExp(
    `(?:^| )(?:${numAlternation})(?: \\d{4,5})? ${escapedName}(?: |$)`,
  );
  if (!namePattern.test(loc)) return null;

  const reasons: string[] = ["num+name"];
  let score = 60;

  if (parts.streetSuffix) {
    // After the name we expect "<SUFFIX><alphanum-subparcel>", e.g.
    // "HAIGHT ST0000". After whitespace squash: "... HAIGHT ST0000".
    const suffixPattern = new RegExp(
      ` ${escapedName} ${escapeRegex(parts.streetSuffix)}[A-Z0-9]`,
    );
    if (suffixPattern.test(loc)) {
      score += 15;
      reasons.push("suffix");
    }
  }

  if (parts.listingSqft && parts.listingSqft > 0) {
    const bldg = num(row.property_area);
    if (bldg != null && bldg > 0) {
      const ratio = bldg / parts.listingSqft;
      if (ratio >= 0.5 && ratio <= 2.0) {
        score += 15;
        reasons.push("sqft-close");
      }
    }
  }

  if (parts.listingUnits && parts.listingUnits > 0) {
    const u = num(row.number_of_units);
    if (u != null && u > 0 && Math.abs(u - parts.listingUnits) <= 1) {
      score += 10;
      reasons.push("units");
    }
  }

  return { score, reasons };
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
