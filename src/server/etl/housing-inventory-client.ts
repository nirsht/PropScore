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

const SELECT_FIELDS =
  "blocklot,net_units,net_units_completed,bmr_reporting_year,first_completion_date,latest_completion_date";

/**
 * Parcels per request when fetching in bulk.
 *
 * Unlike the NOV/complaint feeds this dataset exposes a single `blocklot`
 * column (no separate block/lot), so we batch on the full parcel id rather
 * than the block. 52k candidate listings resolve to ~31.6k distinct
 * blockLots, which at 100/request is ~317 requests (≈6 min under the global
 * 1.1s throttle) instead of 74.5k requests (≈22.8 hours).
 *
 * This is a small, sparse dataset — only parcels with completed housing
 * production appear at all — so rows-per-request stays tiny.
 */
const BLOCKLOTS_PER_REQUEST = 100;
/** Socrata's per-request row ceiling. */
const ROW_LIMIT = 50_000;

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

/** Sum the recent-window net unit change across one parcel's rows. */
function summarize(blockLot: string, rows: HousingInventoryRow[]): HousingInventorySummary {
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

/** Fetch every row matching `where`, paging on `:id`. */
async function fetchPaged(where: string): Promise<HousingInventoryRow[]> {
  const out: HousingInventoryRow[] = [];
  for (let offset = 0; ; offset += ROW_LIMIT) {
    const params = new URLSearchParams({
      $where: where,
      $select: SELECT_FIELDS,
      $order: ":id",
      $limit: String(ROW_LIMIT),
      $offset: String(offset),
    });
    const rows = await fetchJson(`${BASE_URL}?${params.toString()}`);
    out.push(...rows);
    if (rows.length < ROW_LIMIT) break;
  }
  return out;
}

/**
 * Bulk lookup: net unit change for many parcels at once, keyed by blockLot.
 *
 * Parcels with no housing-production history have no entry in the returned
 * map — that is the common case, and callers must treat a miss as
 * `netUnitChange5y: 0` and still mark the listing as fetched.
 */
export async function fetchByBlockLots(
  blockLots: string[],
): Promise<Map<string, HousingInventorySummary>> {
  const unique = [...new Set(blockLots)];
  const byBlockLot = new Map<string, HousingInventoryRow[]>();

  for (let i = 0; i < unique.length; i += BLOCKLOTS_PER_REQUEST) {
    const chunk = unique.slice(i, i + BLOCKLOTS_PER_REQUEST);
    const inList = chunk.map((b) => `'${b.replace(/'/g, "''")}'`).join(",");
    const rows = await fetchPaged(`blocklot IN (${inList})`);
    for (const row of rows) {
      const key = typeof row.blocklot === "string" ? row.blocklot.trim() : "";
      if (!key) continue;
      const bucket = byBlockLot.get(key);
      if (bucket) bucket.push(row);
      else byBlockLot.set(key, [row]);
    }
  }

  const out = new Map<string, HousingInventorySummary>();
  for (const [blockLot, rows] of byBlockLot) {
    out.set(blockLot, summarize(blockLot, rows));
  }
  return out;
}

/**
 * Sum the last N years of net unit change on a parcel. Returns 0 (not null)
 * when the parcel has no inventory rows — callers persist this as a "fetched"
 * state so the script is idempotent.
 *
 * Prefer `fetchByBlockLots` for sweeps: this issues one throttled request per
 * parcel.
 */
export async function fetchByBlockLot(blockLot: string): Promise<HousingInventorySummary> {
  const byBlockLot = await fetchByBlockLots([blockLot]);
  return byBlockLot.get(blockLot) ?? { blockLot, netUnitChange5y: 0 };
}
