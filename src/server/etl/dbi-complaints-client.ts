/**
 * SF DBI Inspection Complaints — Socrata client.
 *
 * Dataset: 9c7e-yn3d (https://data.sfgov.org/Housing-and-Buildings/DBI-Inspection-Complaints/9c7e-yn3d)
 * One row per inspection visit on a complaint; we dedupe to one row per
 * `complaint_number` before counting so a complaint with multiple inspections
 * doesn't inflate the totals. The dataset has no "date filed" column, so we
 * use `last_inspection_date` as the freshness proxy — DBI logs the first
 * inspection within days of complaint intake. Summarized per-parcel: open
 * count, 5y total count, and the most recent complaint breadcrumb. Joined to
 * `Listing.blockLot` via the dataset's `block` + `lot` columns (canonicalized
 * to the 7-char form by `canonicalBlockLot`).
 *
 * Counterpart to the NOV (nbtm-fbw5) feed — DBI complaints are a superset:
 * most public complaints never escalate to an NOV.
 *
 * Anonymous Socrata access, ~1 req/sec throttle.
 */

import { canonicalBlockLot } from "./permits-client";

const BASE_URL = "https://data.sfgov.org/resource/9c7e-yn3d.json";
const THROTTLE_MS = 1100;
const RECENT_WINDOW_YEARS = 5;

const SELECT_FIELDS =
  "complaint_number,last_inspection_date,date_abated,status,complaint_description,street_number,street_name,street_suffix,block,lot";

/**
 * Parcels per request when fetching in bulk. See the equivalent constant in
 * `code-enforcement-client.ts` for the reasoning — same global 1.1s throttle,
 * same block-level batching, and this dataset measured at ~2,860 rows /
 * 1.0 MB / 2.4s for the 25 heaviest blocks.
 */
const BLOCKS_PER_REQUEST = 25;
/** Socrata's per-request row ceiling. */
const ROW_LIMIT = 50_000;

let lastRequestAt = 0;

async function throttle() {
  const now = Date.now();
  const wait = Math.max(0, lastRequestAt + THROTTLE_MS - now);
  lastRequestAt = now + wait;
  if (wait > 0) await new Promise((r) => setTimeout(r, wait));
}

export type ComplaintRow = {
  complaint_number?: string;
  last_inspection_date?: string;
  date_abated?: string;
  status?: string;
  complaint_description?: string;
  street_number?: string;
  street_name?: string;
  street_suffix?: string;
  block?: string;
  lot?: string;
  [k: string]: unknown;
};

export type ComplaintLatest = {
  complaintNumber: string | null;
  dateOpened: string | null;
  status: string | null;
  description: string | null;
  address: string | null;
};

export type ComplaintSummary = {
  blockLot: string;
  openCount: number;
  recentCount: number;
  latest: ComplaintLatest | null;
  // Every deduped complaint on the parcel, newest first — same rows `latest`
  // is drawn from, just not discarded. Powers the "View details" drill-down.
  records: ComplaintLatest[];
};

function str(v: unknown): string | null {
  if (typeof v !== "string") return null;
  const t = v.trim();
  return t.length > 0 ? t : null;
}

// A complaint is "open" when DBI hasn't recorded an abatement date and the
// status doesn't already signal closure. Treat missing status as open to stay
// conservative.
function isOpen(dateAbated: string | null, status: string | null): boolean {
  if (dateAbated) return false;
  if (!status) return true;
  const s = status.toLowerCase().trim();
  return !(s === "abated" || s === "closed" || s === "complete" || s === "completed");
}

function fmtAddress(row: ComplaintRow): string | null {
  const parts = [
    str(row.street_number),
    str(row.street_name),
    str(row.street_suffix),
  ].filter((p): p is string => !!p);
  return parts.length ? parts.join(" ") : null;
}

async function fetchJson(url: string): Promise<ComplaintRow[]> {
  await throttle();
  const res = await fetch(url, { headers: { Accept: "application/json" } });
  if (!res.ok) {
    throw new Error(
      `DBI complaints ${res.status} ${res.statusText}: ${(await res.text()).slice(0, 500)}`,
    );
  }
  return (await res.json()) as ComplaintRow[];
}

export function emptyComplaintSummary(blockLot: string): ComplaintSummary {
  return { blockLot, openCount: 0, recentCount: 0, latest: null, records: [] };
}

/**
 * Fetch every row matching `where`, paging on `:id`.
 *
 * Paging is ordered by the Socrata system id rather than
 * `last_inspection_date`, since `$offset` needs a total order and the date
 * has heavy ties. `summarize` sorts by date itself instead of relying on
 * server order.
 */
async function fetchPaged(where: string): Promise<ComplaintRow[]> {
  const out: ComplaintRow[] = [];
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

/** Roll a single parcel's rows up into a summary. */
function summarize(blockLot: string, rows: ComplaintRow[]): ComplaintSummary {
  const cutoff = new Date();
  cutoff.setFullYear(cutoff.getFullYear() - RECENT_WINDOW_YEARS);

  // Newest first. `fetchPaged` orders by `:id` for stable paging, so the date
  // ordering the dedupe below depends on is established here.
  const sorted = [...rows].sort((a, b) => {
    const da = str(a.last_inspection_date) ?? "";
    const dbv = str(b.last_inspection_date) ?? "";
    return dbv.localeCompare(da);
  });

  let openCount = 0;
  let recentCount = 0;
  let latest: ComplaintLatest | null = null;
  const records: ComplaintLatest[] = [];
  // Dedupe to one row per complaint — the dataset has one row per inspection
  // visit, so a complaint with multiple inspections would otherwise inflate
  // counts. Rows are sorted last_inspection_date DESC, so the first
  // occurrence is the freshest.
  const seenComplaints = new Set<string>();

  for (const row of sorted) {
    const complaintNumber = str(row.complaint_number);
    if (complaintNumber) {
      if (seenComplaints.has(complaintNumber)) continue;
      seenComplaints.add(complaintNumber);
    }

    const status = str(row.status);
    const dateAbated = str(row.date_abated);
    const dateOpened = str(row.last_inspection_date);
    const openedAt = dateOpened ? new Date(dateOpened) : null;
    const inWindow =
      openedAt && Number.isFinite(openedAt.getTime()) && openedAt >= cutoff;

    if (isOpen(dateAbated, status)) openCount += 1;
    if (inWindow) recentCount += 1;

    const record: ComplaintLatest = {
      complaintNumber,
      dateOpened,
      status,
      description: str(row.complaint_description),
      address: fmtAddress(row),
    };
    records.push(record);
    if (!latest && dateOpened) {
      latest = record;
    }
  }

  return { blockLot, openCount, recentCount, latest, records };
}

/**
 * Bulk lookup: fetch complaint history for every parcel on the given blocks
 * in a single request per `BLOCKS_PER_REQUEST` chunk, keyed by canonical
 * 7-char blockLot.
 *
 * Blocks with no complaint history simply have no entries in the returned map
 * — callers must treat a miss as "zero complaints, still mark as fetched"
 * (see `emptyComplaintSummary`), not as an error.
 */
export async function fetchByBlocks(
  blocks: string[],
): Promise<Map<string, ComplaintSummary>> {
  const unique = [...new Set(blocks.map((b) => b.padStart(4, "0")))];
  const byBlockLot = new Map<string, ComplaintRow[]>();

  for (let i = 0; i < unique.length; i += BLOCKS_PER_REQUEST) {
    const chunk = unique.slice(i, i + BLOCKS_PER_REQUEST);
    const inList = chunk.map((b) => `'${b.replace(/'/g, "''")}'`).join(",");
    const rows = await fetchPaged(`block IN (${inList})`);
    for (const row of rows) {
      const key = canonicalBlockLot(str(row.block), str(row.lot));
      const bucket = byBlockLot.get(key);
      if (bucket) bucket.push(row);
      else byBlockLot.set(key, [row]);
    }
  }

  const out = new Map<string, ComplaintSummary>();
  for (const [blockLot, rows] of byBlockLot) {
    out.set(blockLot, summarize(blockLot, rows));
  }
  return out;
}

/**
 * Look up a single parcel's complaint summary. Returns a synthetic empty
 * summary (`null` latest, zero counts) when the parcel has no complaint
 * history — callers should still persist this as a "fetched" state.
 *
 * Prefer `fetchByBlocks` for sweeps: this issues one throttled request per
 * parcel, which is ~18x more requests for the same coverage.
 */
export async function fetchByBlockLot(blockLot: string): Promise<ComplaintSummary> {
  if (blockLot.length < 7) return emptyComplaintSummary(blockLot);
  const byBlockLot = await fetchByBlocks([blockLot.slice(0, 4)]);
  return byBlockLot.get(blockLot) ?? emptyComplaintSummary(blockLot);
}
