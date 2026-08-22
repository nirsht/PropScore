/**
 * SF DBI Notice of Violations — Socrata client.
 *
 * Dataset: nbtm-fbw5 (https://data.sfgov.org/Housing-and-Buildings/Notices-of-Violation-issued-by-the-Department-of-B/nbtm-fbw5)
 * One row per NOV *item* (complaint_number + item_sequence_number); we dedupe
 * to one row per complaint before counting so summaries stay per-NOV, not
 * per-violation-item. Summarized per-parcel: open count, 5y total count, and
 * the most recent NOV breadcrumb. Joined to `Listing.blockLot` via the
 * dataset's `block` + `lot` columns (zero-padded, then concatenated to the
 * canonical 7-char form by `canonicalBlockLot`).
 *
 * Anonymous Socrata access, ~1 req/sec throttle.
 */

import { canonicalBlockLot } from "./permits-client";

const BASE_URL = "https://data.sfgov.org/resource/nbtm-fbw5.json";
const THROTTLE_MS = 1100;
const RECENT_WINDOW_YEARS = 5;

const SELECT_FIELDS =
  "complaint_number,date_filed,status,nov_item_description,street_number,street_name,street_suffix,block,lot";

/**
 * Parcels per request when fetching in bulk.
 *
 * The throttle below is a *global* 1.1s serialization (see `throttle()`), so
 * per-request latency is irrelevant and request *count* is the only thing
 * that matters. One-parcel-per-request meant 74.5k requests ≈ 22.8 hours for
 * a single nightly stage. Batching by `block` collapses that: 52k candidate
 * listings share only ~4.1k distinct blocks, and a block-level query returns
 * every lot on the block for free.
 *
 * 25 blocks/request measured at ~2,900 rows / 1.1 MB / 2.7s against the 25
 * *heaviest* blocks in the dataset — comfortably inside ROW_LIMIT, with the
 * paging loop in `fetchPaged` as a backstop.
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

export type NovRow = {
  complaint_number?: string;
  date_filed?: string;
  status?: string;
  description?: string;
  street_number?: string;
  street_name?: string;
  street_suffix?: string;
  block?: string;
  lot?: string;
  [k: string]: unknown;
};

export type NovLatest = {
  complaintNumber: string | null;
  dateFiled: string | null;
  status: string | null;
  description: string | null;
  address: string | null;
};

export type NovSummary = {
  blockLot: string;
  openCount: number;
  recentCount: number;
  latest: NovLatest | null;
  // Every deduped NOV on the parcel, newest first — same rows `latest` is
  // drawn from, just not discarded. Powers the "View details" drill-down.
  records: NovLatest[];
};

function str(v: unknown): string | null {
  if (typeof v !== "string") return null;
  const t = v.trim();
  return t.length > 0 ? t : null;
}

// nbtm-fbw5 uses a binary status vocabulary: "active" or "not active".
// Treat missing/unknown statuses as open to stay conservative.
function isOpen(status: string | null): boolean {
  if (!status) return true;
  return status.toLowerCase().trim() === "active";
}

function fmtAddress(row: NovRow): string | null {
  const parts = [
    str(row.street_number),
    str(row.street_name),
    str(row.street_suffix),
  ].filter((p): p is string => !!p);
  return parts.length ? parts.join(" ") : null;
}

async function fetchJson(url: string): Promise<NovRow[]> {
  await throttle();
  const res = await fetch(url, { headers: { Accept: "application/json" } });
  if (!res.ok) {
    throw new Error(
      `NOV ${res.status} ${res.statusText}: ${(await res.text()).slice(0, 500)}`,
    );
  }
  return (await res.json()) as NovRow[];
}

export function emptyNovSummary(blockLot: string): NovSummary {
  return { blockLot, openCount: 0, recentCount: 0, latest: null, records: [] };
}

/**
 * Fetch every row matching `where`, paging on `:id`.
 *
 * Paging is ordered by the Socrata system id rather than `date_filed`, since
 * `$offset` needs a total order and `date_filed` has heavy ties. The rollup
 * in `summarize` therefore sorts by date itself instead of relying on server
 * order.
 */
async function fetchPaged(where: string): Promise<NovRow[]> {
  const out: NovRow[] = [];
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
function summarize(blockLot: string, rows: NovRow[]): NovSummary {
  const cutoff = new Date();
  cutoff.setFullYear(cutoff.getFullYear() - RECENT_WINDOW_YEARS);

  // Newest first. `fetchPaged` orders by `:id` for stable paging, so the
  // date ordering the dedupe below depends on is established here.
  const sorted = [...rows].sort((a, b) => {
    const da = str(a.date_filed) ?? "";
    const dbv = str(b.date_filed) ?? "";
    return dbv.localeCompare(da);
  });

  let openCount = 0;
  let recentCount = 0;
  let latest: NovLatest | null = null;
  const records: NovLatest[] = [];
  // Dedupe to one row per complaint — the dataset has one row per NOV item,
  // so a single NOV with multiple violations would otherwise inflate counts.
  // Rows are sorted date_filed DESC, so the first occurrence is the freshest.
  const seenComplaints = new Set<string>();

  for (const row of sorted) {
    const complaintNumber = str(row.complaint_number);
    if (complaintNumber) {
      if (seenComplaints.has(complaintNumber)) continue;
      seenComplaints.add(complaintNumber);
    }

    const status = str(row.status);
    const dateFiled = str(row.date_filed);
    const filedAt = dateFiled ? new Date(dateFiled) : null;
    const inWindow = filedAt && Number.isFinite(filedAt.getTime()) && filedAt >= cutoff;

    if (isOpen(status)) openCount += 1;
    if (inWindow) recentCount += 1;

    const record: NovLatest = {
      complaintNumber,
      dateFiled,
      status,
      description: str(row.nov_item_description),
      address: fmtAddress(row),
    };
    records.push(record);
    if (!latest && dateFiled) {
      latest = record;
    }
  }

  return { blockLot, openCount, recentCount, latest, records };
}

/**
 * Bulk lookup: fetch NOV history for every parcel on the given blocks in a
 * single request per `BLOCKS_PER_REQUEST` chunk, keyed by canonical 7-char
 * blockLot.
 *
 * Blocks with no NOV history simply have no entries in the returned map —
 * callers must treat a miss as "zero violations, still mark as fetched"
 * (see `emptyNovSummary`), not as an error.
 */
export async function fetchByBlocks(blocks: string[]): Promise<Map<string, NovSummary>> {
  const unique = [...new Set(blocks.map((b) => b.padStart(4, "0")))];
  const byBlockLot = new Map<string, NovRow[]>();

  for (let i = 0; i < unique.length; i += BLOCKS_PER_REQUEST) {
    const chunk = unique.slice(i, i + BLOCKS_PER_REQUEST);
    // Socrata string literals are single-quoted; block ids are digits-only
    // from our own DB, but escape defensively anyway.
    const inList = chunk.map((b) => `'${b.replace(/'/g, "''")}'`).join(",");
    const rows = await fetchPaged(`block IN (${inList})`);
    for (const row of rows) {
      const key = canonicalBlockLot(str(row.block), str(row.lot));
      const bucket = byBlockLot.get(key);
      if (bucket) bucket.push(row);
      else byBlockLot.set(key, [row]);
    }
  }

  const out = new Map<string, NovSummary>();
  for (const [blockLot, rows] of byBlockLot) {
    out.set(blockLot, summarize(blockLot, rows));
  }
  return out;
}

/**
 * Look up a single parcel's NOV summary. Returns a synthetic empty summary
 * (`null` latest, zero counts) when the parcel has no NOV history — callers
 * should still persist this as a "fetched" state.
 *
 * Prefer `fetchByBlocks` for sweeps: this issues one throttled request per
 * parcel, which is ~18x more requests for the same coverage.
 */
export async function fetchByBlockLot(blockLot: string): Promise<NovSummary> {
  if (blockLot.length < 7) return emptyNovSummary(blockLot);
  const byBlockLot = await fetchByBlocks([blockLot.slice(0, 4)]);
  return byBlockLot.get(blockLot) ?? emptyNovSummary(blockLot);
}
