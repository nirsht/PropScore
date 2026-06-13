/**
 * SF Housing Inventory — Socrata client.
 *
 * Dataset: xdht-4php — "Housing Production - 2005-present"
 * (https://data.sfgov.org/Housing-and-Buildings/Housing-Production/xdht-4php).
 * Replaces the retired `6v9b-p59r` dataset, which DataSF now returns
 * `404 dataset.missing` for. One row per completed building event with a
 * `net_units` count (positive = gain from new construction or unit-add;
 * negative = loss from demolition, mergers, conversion, or removal).
 * Joined to `Listing.blockLot` via the dataset's `blocklot` parcel ID
 * (note: single field now, where the old dataset had both `mapblklot`
 * and `blklot`).
 *
 * We sum `net_units` over the last N reporting years and surface that as a
 * single risk signal: net unit *loss* on a parcel is a constraint on rental
 * upside (and often a rent-control trigger); net unit *gain* is upside.
 *
 * Anonymous Socrata access, ~1 req/sec throttle.
 */

const BASE_URL = "https://data.sfgov.org/resource/xdht-4php.json";
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
  blocklot?: string;
  net_units?: string;
  net_units_completed?: string;
  bmr_reporting_year?: string;
  first_completion_date?: string;
  latest_completion_date?: string;
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
  // Prefer the BMR reporting year (annual reporting bucket). Fall back to
  // the latest completion date, then the first completion date.
  const y = int(row.bmr_reporting_year);
  if (y != null) return y;
  for (const k of ["latest_completion_date", "first_completion_date"] as const) {
    const v = row[k];
    if (typeof v !== "string") continue;
    const d = new Date(v);
    if (Number.isFinite(d.getTime())) return d.getUTCFullYear();
  }
  return null;
}

function rowNetUnits(row: HousingInventoryRow): number | null {
  // Prefer `net_units_completed` (the count actually delivered as of the
  // reporting year); fall back to `net_units` (proposed). The old dataset
  // exposed only `net_units`/`units_net`/`units`.
  return int(row.net_units_completed) ?? int(row.net_units);
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
  // The current dataset uses a single `blocklot` field.
  const params = new URLSearchParams({
    $where: `blocklot='${blockLot}'`,
    $select:
      "blocklot,net_units,net_units_completed,bmr_reporting_year,first_completion_date,latest_completion_date",
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
