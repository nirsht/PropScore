/**
 * SF DBI Notice of Violations — Socrata client.
 *
 * Dataset: nife-svxp (https://data.sfgov.org/Housing-and-Buildings/Building-Notices-of-Violations/nife-svxp)
 * One row per NOV. We summarize per-parcel: open count, 5y total count,
 * and the most recent NOV breadcrumb. Joined to `Listing.blockLot` via the
 * dataset's `block` + `lot` columns (zero-padded, then concatenated to the
 * canonical 7-char form by `canonicalBlockLot`).
 *
 * Anonymous Socrata access, ~1 req/sec throttle.
 */

import { canonicalBlockLot } from "./permits-client";

const BASE_URL = "https://data.sfgov.org/resource/nife-svxp.json";
const THROTTLE_MS = 1100;
const RECENT_WINDOW_YEARS = 5;
// Open NOVs are anything not yet abated/closed. The dataset uses a free-text
// `status` column; these are the closed/abated terminal states observed in
// production samples — anything else is treated as open.
const CLOSED_STATUSES = new Set([
  "abated",
  "complied",
  "closed",
  "complaint closed",
  "violation abated",
  "withdrawn",
]);

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

function isOpen(status: string | null): boolean {
  if (!status) return true;
  return !CLOSED_STATUSES.has(status.toLowerCase().trim());
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
      "complaint_number,date_filed,status,description,street_number,street_name,street_suffix,block,lot",
    $order: "date_filed DESC",
    $limit: "1000",
  });
  const rows = await fetchJson(`${BASE_URL}?${params.toString()}`);

  const cutoff = new Date();
  cutoff.setFullYear(cutoff.getFullYear() - RECENT_WINDOW_YEARS);

  let openCount = 0;
  let recentCount = 0;
  let latest: NovLatest | null = null;

  for (const row of rows) {
    const status = str(row.status);
    const dateFiled = str(row.date_filed);
    const filedAt = dateFiled ? new Date(dateFiled) : null;
    const inWindow = filedAt && Number.isFinite(filedAt.getTime()) && filedAt >= cutoff;

    if (isOpen(status)) openCount += 1;
    if (inWindow) recentCount += 1;

    if (!latest && dateFiled) {
      latest = {
        complaintNumber: str(row.complaint_number),
        dateFiled,
        status,
        description: str(row.description),
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
