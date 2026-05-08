/**
 * SF Land Use 2023 — Socrata client.
 *
 * Dataset: fdfd-xptc (https://data.sfgov.org/Geographic-Locations-and-Boundaries/-ARCHIVED-San-Francisco-Land-Use-2023/fdfd-xptc)
 * Land use category for every SF parcel. Marked "ARCHIVED" upstream because
 * 2023 is the latest year-stamped snapshot DataSF publishes — the wrapper
 * datasets (us3s-fp9q etc.) are map/redirect shells with no tabular rows,
 * so this is what we actually want.
 *
 * Joined to `Listing.blockLot` via `mapblklot` (same 7-char parcel ID).
 *
 * Anonymous Socrata access, ~1 req/sec throttle.
 */

const BASE_URL = "https://data.sfgov.org/resource/fdfd-xptc.json";
const THROTTLE_MS = 1100;

let lastRequestAt = 0;

async function throttle() {
  const now = Date.now();
  const wait = Math.max(0, lastRequestAt + THROTTLE_MS - now);
  lastRequestAt = now + wait;
  if (wait > 0) await new Promise((r) => setTimeout(r, wait));
}

export type LandUseRow = {
  mapblklot?: string;
  landuse?: string;
  /** Residential building sqft on the parcel. */
  res?: string;
  /** Total commercial-ish sqft on the parcel (CIE+MED+MIPS+RETAIL+PDR+VISITOR). */
  totalcomm?: string;
  resunits?: string;
  cie?: string;
  med?: string;
  mips?: string;
  retail?: string;
  pdr?: string;
  visitor?: string;
  [k: string]: unknown;
};

export type LandUseRecord = {
  blockLot: string;
  category: string | null;
  resUnits: number | null;
  resSqft: number | null;
  commSqft: number | null;
  raw: LandUseRow;
};

function int(v: unknown): number | null {
  if (typeof v !== "string" || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? Math.round(n) : null;
}

function str(v: unknown): string | null {
  if (typeof v !== "string") return null;
  const trimmed = v.trim();
  return trimmed.length > 0 ? trimmed : null;
}

export function mapLandUseRow(row: LandUseRow): LandUseRecord | null {
  const blockLot = str(row.mapblklot);
  if (!blockLot) return null;
  return {
    blockLot,
    category: str(row.landuse),
    resUnits: int(row.resunits),
    resSqft: int(row.res),
    commSqft: int(row.totalcomm),
    raw: row,
  };
}

async function fetchJson(url: string): Promise<LandUseRow[]> {
  await throttle();
  const res = await fetch(url, { headers: { Accept: "application/json" } });
  if (!res.ok) {
    throw new Error(
      `LandUse ${res.status} ${res.statusText}: ${(await res.text()).slice(0, 500)}`,
    );
  }
  return (await res.json()) as LandUseRow[];
}

/**
 * Look up a single parcel's land-use record. Returns the first match — the
 * dataset has one row per parcel, so duplicates indicate sub-parcels
 * (condos sharing a `mapblklot`) and the first row is sufficient.
 */
export async function fetchByBlockLot(blockLot: string): Promise<LandUseRecord | null> {
  const params = new URLSearchParams({
    mapblklot: blockLot,
    $limit: "1",
    // Don't pull the geometry — `the_geom` MultiPolygons are huge and we
    // already have parcel locations from MLS lat/lng + Listing.geom.
    $select: "mapblklot,landuse,resunits,res,totalcomm,cie,med,mips,retail,pdr,visitor",
  });
  const rows = await fetchJson(`${BASE_URL}?${params.toString()}`);
  const row = rows[0];
  return row ? mapLandUseRow(row) : null;
}
