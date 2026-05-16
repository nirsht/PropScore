/**
 * Address parsing and suffix normalization shared between the SFPIM
 * Socrata client and any caller that needs to compare addresses against
 * the assessor's fixed-width `property_location` encoding.
 */

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

export function zeroPad(n: string, width = 4): string {
  return n.length >= width ? n : "0".repeat(width - n.length) + n;
}

export function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
