/**
 * SF Housing Inventory — Socrata client.
 *
 * Dataset: 6v9b-p59r (https://data.sfgov.org/Housing-and-Buildings/Housing-Inventory/6v9b-p59r)
 * One row per completed building event with a `net_units` count (positive =
 * gain from new construction or unit-add; negative = loss from demolition,
 * mergers, conversion, or removal). Joined to `Listing.blockLot` via the
 * dataset's `mapblklot` (or `blklot`) parcel ID.
 *
 * We sum `net_units` over the last N reporting years and surface that as a
 * single risk signal: net unit *loss* on a parcel is a constraint on rental
 * upside (and often a rent-control trigger); net unit *gain* is upside.
 *
 * Anonymous Socrata access, ~1 req/sec throttle.
 */

const BASE_URL = "https://data.sfgov.org/resource/6v9b-p59r.json";
const THROTTLE_MS = 1100;
const RECENT_WINDOW_YEARS = 5;

let lastRequestAt = 0;

async function throttle() {
  const now = Date.now();
  const wait = Math.max(0, lastRequestAt + THROTTLE_MS - now);
  lastRequestAt = now + wait;
  if (wait > 0) await new Promise((r) => setTimeout(r, wait));
}

export type HousingInventoryRow = {
  mapblklot?: string;
  blklot?: string;
  net_units?: string;
  units?: string;
  units_net?: string;
  year?: string;
  date_issued?: string;
  [k: string]: unknown;
};

export type HousingInventorySummary = {
  blockLot: string;
  /** Sum of net unit changes attributed to this parcel over the recent window. */
  netUnitChange5y: number;
};

function int(v: unknown): number | null {
  if (typeof v !== "string" || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? Math.round(n) : null;
}

function rowYear(row: HousingInventoryRow): number | null {
  const y = int(row.year);
  if (y != null) return y;
  const d = typeof row.date_issued === "string" ? new Date(row.date_issued) : null;
  return d && Number.isFinite(d.getTime()) ? d.getUTCFullYear() : null;
}

function rowNetUnits(row: HousingInventoryRow): number | null {
  // The dataset has used a few column names for the net change across
  // publishing years (`net_units`, `units_net`, plain `units` in some
  // historical years). Try them in order — first non-null wins.
  return int(row.net_units) ?? int(row.units_net) ?? int(row.units);
}

async function fetchJson(url: string): Promise<HousingInventoryRow[]> {
  await throttle();
  const res = await fetch(url, { headers: { Accept: "application/json" } });
  if (!res.ok) {
    throw new Error(
      `HousingInventory ${res.status} ${res.statusText}: ${(await res.text()).slice(0, 500)}`,
    );
  }
  return (await res.json()) as HousingInventoryRow[];
}

/**
 * Sum the last N years of net unit change on a parcel. Returns 0 (not null)
 * when the parcel has no inventory rows — callers persist this as a "fetched"
 * state so the script is idempotent.
 */
export async function fetchByBlockLot(blockLot: string): Promise<HousingInventorySummary> {
  // The dataset mostly uses `mapblklot`; older rows use `blklot`. OR-filter
  // both so we don't miss either.
  const params = new URLSearchParams({
    $where: `mapblklot='${blockLot}' OR blklot='${blockLot}'`,
    $select: "mapblklot,blklot,net_units,units,units_net,year,date_issued",
    $limit: "200",
  });
  const rows = await fetchJson(`${BASE_URL}?${params.toString()}`);

  const cutoffYear = new Date().getUTCFullYear() - RECENT_WINDOW_YEARS;
  let net = 0;
  for (const row of rows) {
    const year = rowYear(row);
    if (year == null || year < cutoffYear) continue;
    const delta = rowNetUnits(row);
    if (delta == null) continue;
    net += delta;
  }

  return { blockLot, netUnitChange5y: net };
}
