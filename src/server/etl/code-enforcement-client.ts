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

/**
 * Look up all NOV rows for a single parcel and roll them up into a summary.
 * The dataset stores `block`/`lot` separately, so we filter by both columns
 * (canonicalized to match `Listing.blockLot`'s 7-char form). Returns a
 * synthetic empty summary (`null` latest, zero counts) when the parcel has
 * no NOV history — callers should still persist this as a "fetched" state.
 */
export async function fetchByBlockLot(blockLot: string): Promise<NovSummary> {
  if (blockLot.length < 7) {
    return { blockLot, openCount: 0, recentCount: 0, latest: null };
  }
  const block = blockLot.slice(0, 4);
  const lot = blockLot.slice(4);
  const params = new URLSearchParams({
    $where: `block='${block}' AND lot='${lot}'`,
    $select:
      "complaint_number,date_filed,status,nov_item_description,street_number,street_name,street_suffix,block,lot",
    $order: "date_filed DESC",
    $limit: "1000",
  });
  const rows = await fetchJson(`${BASE_URL}?${params.toString()}`);

  const cutoff = new Date();
  cutoff.setFullYear(cutoff.getFullYear() - RECENT_WINDOW_YEARS);

  let openCount = 0;
  let recentCount = 0;
  let latest: NovLatest | null = null;
  // Dedupe to one row per complaint — the dataset has one row per NOV item,
  // so a single NOV with multiple violations would otherwise inflate counts.
  // Rows are ordered date_filed DESC, so the first occurrence is the freshest.
  const seenComplaints = new Set<string>();

  for (const row of rows) {
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

    if (!latest && dateFiled) {
      latest = {
        complaintNumber,
        dateFiled,
        status,
        description: str(row.nov_item_description),
        address: fmtAddress(row),
      };
    }
  }

  // Canonicalize the returned blockLot — the dataset's block/lot columns
  // sometimes drop leading zeros. Use the first row's parsed values when
  // available, otherwise fall back to the input.
  const first = rows[0];
  const canonical = first?.block && first?.lot
    ? canonicalBlockLot(first.block, first.lot)
    : blockLot;

  return { blockLot: canonical, openCount, recentCount, latest };
}
