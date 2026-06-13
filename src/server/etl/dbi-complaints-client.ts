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

/**
 * Look up all DBI complaint rows for a single parcel and roll them up into a
 * summary. The dataset stores `block`/`lot` separately, so we filter by both
 * columns (canonicalized to match `Listing.blockLot`'s 7-char form). Returns
 * a synthetic empty summary (`null` latest, zero counts) when the parcel has
 * no complaint history — callers should still persist this as a "fetched"
 * state.
 */
export async function fetchByBlockLot(blockLot: string): Promise<ComplaintSummary> {
  if (blockLot.length < 7) {
    return { blockLot, openCount: 0, recentCount: 0, latest: null };
  }
  const block = blockLot.slice(0, 4);
  const lot = blockLot.slice(4);
  const params = new URLSearchParams({
    $where: `block='${block}' AND lot='${lot}'`,
    $select:
      "complaint_number,last_inspection_date,date_abated,status,complaint_description,street_number,street_name,street_suffix,block,lot",
    $order: "last_inspection_date DESC",
    $limit: "1000",
  });
  const rows = await fetchJson(`${BASE_URL}?${params.toString()}`);

  const cutoff = new Date();
  cutoff.setFullYear(cutoff.getFullYear() - RECENT_WINDOW_YEARS);

  let openCount = 0;
  let recentCount = 0;
  let latest: ComplaintLatest | null = null;
  // Dedupe to one row per complaint — the dataset has one row per inspection
  // visit, so a complaint with multiple inspections would otherwise inflate
  // counts. Rows are ordered last_inspection_date DESC, so the first
  // occurrence is the freshest.
  const seenComplaints = new Set<string>();

  for (const row of rows) {
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

    if (!latest && dateOpened) {
      latest = {
        complaintNumber,
        dateOpened,
        status,
        description: str(row.complaint_description),
        address: fmtAddress(row),
      };
    }
  }

  // Canonicalize the returned blockLot — the dataset's block/lot columns
  // sometimes drop leading zeros. Use the first row's parsed values when
  // available, otherwise fall back to the input.
  const first = rows[0];
  const canonical =
    first?.block && first?.lot ? canonicalBlockLot(first.block, first.lot) : blockLot;

  return { blockLot: canonical, openCount, recentCount, latest };
}
