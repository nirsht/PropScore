/**
 * Types and coercion helpers for the SF Assessor (SFPIM) Socrata dataset.
 *
 * Socrata returns every column as a string, so callers must coerce numeric
 * fields through these helpers. Kept separate from the HTTP client so that
 * matching/scoring code can consume the types without pulling in fetch logic.
 */

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

export const num = (v: string | undefined): number | null => {
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
