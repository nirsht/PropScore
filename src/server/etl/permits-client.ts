/**
 * SF DBI Building Permits — Socrata client.
 *
 * Dataset: i98e-djp9 (https://data.sfgov.org/Housing-and-Buildings/Building-Permits/i98e-djp9)
 * One row per permit. Used by `scripts/enrich-permits.ts` to hydrate the
 * BuildingPermit table block-by-block, plus to surface ADU/reconfiguration
 * precedent in the listing drawer's FeasibilityCard.
 *
 * Anonymous Socrata access, throttled to ~1 req/sec to stay within the
 * unauthenticated-access guidance (matches sfpim-client.ts/datasf-client.ts).
 */

const BASE_URL = "https://data.sfgov.org/resource/i98e-djp9.json";
const THROTTLE_MS = 1100;
const PAGE_SIZE = 1000;

let lastRequestAt = 0;

async function throttle() {
  const now = Date.now();
  const wait = Math.max(0, lastRequestAt + THROTTLE_MS - now);
  lastRequestAt = now + wait;
  if (wait > 0) await new Promise((r) => setTimeout(r, wait));
}

/**
 * Raw row shape — only the columns we read. Socrata returns scalars as
 * strings; coerce via the helpers below.
 */
export type PermitRow = {
  permit_number?: string;
  block?: string;
  lot?: string;
  filed_date?: string;
  issued_date?: string;
  status?: string;
  description?: string;
  adu?: string; // "Y" | "N" | undefined
  existing_units?: string;
  proposed_units?: string;
  existing_construction_type_description?: string;
  proposed_construction_type_description?: string;
  existing_use?: string;
  proposed_use?: string;
  street_number?: string;
  street_name?: string;
  street_suffix?: string;
  location?: { type: "Point"; coordinates: [number, number] };
  [k: string]: unknown;
};

export type PermitRecord = {
  permitNumber: string;
  blockLot: string;
  block: string;
  lot: string;
  filedDate: Date | null;
  issuedDate: Date | null;
  status: string | null;
  description: string | null;
  aduFlag: boolean;
  aduKeyword: boolean;
  existingUnits: number | null;
  proposedUnits: number | null;
  existingConstructionType: string | null;
  proposedConstructionType: string | null;
  existingUse: string | null;
  proposedUse: string | null;
  lat: number | null;
  lng: number | null;
  address: string | null;
  raw: PermitRow;
};

// Description keywords that indicate an ADU/reconfiguration permit even when
// the dataset's `adu` column is empty — many older permits predate that flag.
// Anchored on whole words to avoid false positives ("legalize" not "legals").
const ADU_KEYWORD_RE =
  /\b(adu|accessory\s+dwelling|unit\s+add(?:ition)?|legaliz(?:e|ed|ation)\s+(?:of\s+)?(?:unit|dwelling)|in[-\s]?law|secondary\s+unit)\b/i;

function num(v: unknown): number | null {
  if (typeof v !== "string" || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function int(v: unknown): number | null {
  const n = num(v);
  return n == null ? null : Math.round(n);
}

function str(v: unknown): string | null {
  if (typeof v !== "string") return null;
  const trimmed = v.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function date(v: unknown): Date | null {
  if (typeof v !== "string" || v === "") return null;
  const d = new Date(v);
  return Number.isFinite(d.getTime()) ? d : null;
}

/**
 * Pad block + lot to canonical 7-char SF parcel ID (4-digit block, 3-digit
 * lot). The Assessor dataset stores parcel_number in this exact form, so
 * `Listing.blockLot` already follows it.
 */
function canonicalBlockLot(block: string | null, lot: string | null): string {
  const b = (block ?? "").padStart(4, "0");
  const l = (lot ?? "").padStart(3, "0");
  return `${b}${l}`;
}

export function mapPermitRow(row: PermitRow): PermitRecord | null {
  const permitNumber = str(row.permit_number);
  const block = str(row.block);
  const lot = str(row.lot);
  if (!permitNumber || !block || !lot) return null;

  const description = str(row.description);
  const aduFlag = str(row.adu)?.toUpperCase() === "Y";
  const aduKeyword = description != null && ADU_KEYWORD_RE.test(description);

  const lng = row.location?.coordinates?.[0] ?? null;
  const lat = row.location?.coordinates?.[1] ?? null;

  const addressParts = [
    str(row.street_number),
    str(row.street_name),
    str(row.street_suffix),
  ].filter((p): p is string => p !== null);
  const address = addressParts.length > 0 ? addressParts.join(" ") : null;

  return {
    permitNumber,
    blockLot: canonicalBlockLot(block, lot),
    block,
    lot,
    filedDate: date(row.filed_date),
    issuedDate: date(row.issued_date),
    status: str(row.status),
    description,
    aduFlag,
    aduKeyword,
    existingUnits: int(row.existing_units),
    proposedUnits: int(row.proposed_units),
    existingConstructionType: str(row.existing_construction_type_description),
    proposedConstructionType: str(row.proposed_construction_type_description),
    existingUse: str(row.existing_use),
    proposedUse: str(row.proposed_use),
    lat: typeof lat === "number" && Number.isFinite(lat) ? lat : null,
    lng: typeof lng === "number" && Number.isFinite(lng) ? lng : null,
    address,
    raw: row,
  };
}

async function fetchJson(url: string): Promise<PermitRow[]> {
  await throttle();
  const res = await fetch(url, { headers: { Accept: "application/json" } });
  if (!res.ok) {
    throw new Error(
      `Permits ${res.status} ${res.statusText}: ${(await res.text()).slice(0, 500)}`,
    );
  }
  return (await res.json()) as PermitRow[];
}

/**
 * Pull every permit on a given `block` filed within the last `sinceYears`
 * years. Single block holds up to ~hundreds of permits over a decade in
 * dense neighborhoods; we paginate to be safe.
 *
 * The block filter is the dominant predicate — we get back a few hundred
 * rows and do all ADU/keyword filtering downstream so the same fetched
 * set can answer multiple precedent questions per listing.
 */
export async function fetchPermitsByBlock(
  block: string,
  sinceYears = 10,
): Promise<PermitRecord[]> {
  const cutoff = new Date();
  cutoff.setFullYear(cutoff.getFullYear() - sinceYears);
  const cutoffSoql = cutoff.toISOString().split(".")[0]; // SoQL dislikes ms

  const rows: PermitRow[] = [];
  for (let offset = 0; ; offset += PAGE_SIZE) {
    const params = new URLSearchParams({
      $where: `block='${block}' AND filed_date > '${cutoffSoql}'`,
      $order: "filed_date DESC",
      $limit: String(PAGE_SIZE),
      $offset: String(offset),
    });
    const page = await fetchJson(`${BASE_URL}?${params.toString()}`);
    rows.push(...page);
    if (page.length < PAGE_SIZE) break;
  }

  return rows.map(mapPermitRow).filter((r): r is PermitRecord => r != null);
}
