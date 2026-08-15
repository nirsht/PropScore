/**
 * Offboard listings that have fallen off Bridge.
 *
 * Strategy:
 *   1. Pull every ListingKey currently Active in Bridge (lightweight —
 *      `$select=ListingKey` only, ~15 paged requests for ~3k listings).
 *   2. Pull listings that recently flipped to a terminal status
 *      (Pending / Active Under Contract / Closed) within the past
 *      STATUS_TRANSITION_LOOKBACK_DAYS — these are status transitions we
 *      want to catch immediately rather than waiting for the listing to
 *      disappear from the Active feed entirely. For each one we still
 *      hold locally, mark deletedAt now and capture the new status.
 *   3. Mark `deletedAt = now()` on any local Active listing whose
 *      ListingKey is NOT in the Active set AND whose `lastSeenAt` predates
 *      the start of this sweep (the "missing for ≥1 sync" guard — a
 *      listing that just got upserted in this same nightly can't be
 *      offboarded by this rule).
 *   4. Resurrect any local listing whose ListingKey IS in the Active set
 *      but whose `deletedAt` is set (e.g., the listing reappeared in
 *      Bridge).
 *
 * Forensic data (scores, enrichments, contacts, chats, emails, documents)
 * is preserved — this is a soft-delete via the `deletedAt` column only.
 *
 * Idempotent: re-running with no new disappearances marks zero rows.
 *
 * Usage: `pnpm offboard:stale` or `pnpm offboard:stale -- --dry-run`.
 */
import { db } from "@/lib/db";
import {
  odataDateTime,
  searchProperties,
  type BridgeProperty,
} from "@/server/etl/bridge-client";

const dryRun = process.argv.includes("--dry-run");

// Terminal MLS statuses we want to catch as soon as Bridge surfaces them,
// instead of waiting for the listing to disappear from the Active feed.
// Names come from RESO `StandardStatus`; SFAR doesn't currently emit
// Withdrawn/Canceled but other datasets do, so we query them anyway —
// missing rows just yield zero results.
const TERMINAL_STATUSES = [
  "Pending",
  "Active Under Contract",
  "Closed",
  "Withdrawn",
  "Canceled",
  "Expired",
] as const;

// How far back to scan for recent terminal-status transitions. Two days
// gives a margin even if a nightly is skipped; older transitions get
// caught by the regular "missing from Active" rule below.
const STATUS_TRANSITION_LOOKBACK_DAYS = 2;

async function main() {
  const sweepStartedAt = new Date();
  // Listings upserted within the same nightly (i.e., within the last few
  // minutes) get a free pass — they were just seen, so any "missing from
  // Bridge" finding for them would be a paging artifact. The guard is the
  // start of THIS sweep: if lastSeenAt < sweepStartedAt, the listing
  // didn't show up in the etl-sync that ran just before us.
  const seenCutoff = sweepStartedAt;

  // ---- 1. Scrape ListingKeys ----
  // Only StandardStatus eq 'Active', matching the etl-sync filter shape —
  // anything we wouldn't pull during sync we also shouldn't keep alive
  // here. The Lease exclusion is preserved for the same reason.
  const liveKeys = new Set<string>();
  let pages = 0;
  const filter = "StandardStatus eq 'Active' and not contains(PropertyType, 'Lease')";
  console.log(`[offboard] scanning Bridge for live ListingKeys…`);
  for await (const row of searchProperties({
    filter,
    select: ["ListingKey"],
  })) {
    const key = (row as BridgeProperty).ListingKey;
    if (typeof key === "string" && key.length > 0) liveKeys.add(key);
    if (liveKeys.size % 1000 === 0 && liveKeys.size > 0) {
      console.log(`[offboard] …${liveKeys.size} keys scanned`);
    }
    pages += 1;
  }
  console.log(
    `[offboard] live keys=${liveKeys.size} (rows iterated=${pages})`,
  );

  if (liveKeys.size === 0) {
    // Safety: if Bridge gave us nothing (auth issue, WAF block), bail
    // before we mark every listing in the DB deleted.
    console.error(
      `[offboard] aborting: zero live keys returned from Bridge — refusing to mark every listing deleted.`,
    );
    process.exit(1);
  }

  const liveKeysArr = Array.from(liveKeys);

  // ---- 2. Catch recent terminal-status transitions ----
  // Bridge keeps emitting a listing for a while after it goes
  // Pending/Closed/etc., with the new StandardStatus. Detect those before
  // they fall out of the feed entirely so the grid stops showing them
  // (with stale prices, DOM, etc.) the same day the MLS flips.
  const lookbackCutoff = new Date(
    sweepStartedAt.getTime() -
      STATUS_TRANSITION_LOOKBACK_DAYS * 24 * 60 * 60 * 1000,
  );
  const transitioned = new Map<string, string>(); // ListingKey → new status
  for (const status of TERMINAL_STATUSES) {
    const filter =
      `StandardStatus eq '${status}' and ` +
      `BridgeModificationTimestamp gt ${odataDateTime(lookbackCutoff)}`;
    let count = 0;
    for await (const row of searchProperties({
      filter,
      select: ["ListingKey", "StandardStatus"],
    })) {
      const key = (row as BridgeProperty).ListingKey;
      if (typeof key === "string" && key.length > 0) {
        transitioned.set(key, status);
        count += 1;
      }
    }
    console.log(`[offboard] transitioned to ${status}: ${count}`);
  }

  // Narrow to listings we actually have locally and haven't already
  // offboarded — there's no point updating rows we don't track.
  const transitionedKeys = Array.from(transitioned.keys());
  const localTransitioned = transitionedKeys.length
    ? await db.listing.findMany({
        where: { mlsId: { in: transitionedKeys }, deletedAt: null },
        select: { mlsId: true },
      })
    : [];

  // ---- 3. Mark stale ----
  // We do this in two steps for clarity, both wrapped in a single
  // transaction so the resurrect doesn't race with the offboard.
  if (dryRun) {
    const wouldOffboard = await db.listing.count({
      where: {
        mlsId: { notIn: liveKeysArr },
        deletedAt: null,
        OR: [{ lastSeenAt: null }, { lastSeenAt: { lt: seenCutoff } }],
      },
    });
    const wouldResurrect = await db.listing.count({
      where: { mlsId: { in: liveKeysArr }, deletedAt: { not: null } },
    });
    const alive = await db.listing.count({ where: { deletedAt: null } });
    console.log(
      `[offboard] DRY-RUN — would offboard=${wouldOffboard}, would transition-offboard=${localTransitioned.length}, would resurrect=${wouldResurrect}, alive=${alive}`,
    );
    return;
  }

  // Count resurrections separately so we can report them (the bump-alive
  // updateMany below sets deletedAt=null unconditionally on every live
  // row, so it doesn't tell us how many were actually previously
  // deleted).
  const resurrectingCount = await db.listing.count({
    where: { mlsId: { in: liveKeysArr }, deletedAt: { not: null } },
  });

  // Writes are chunked rather than run as one big `$transaction([...])`.
  // A single sweep can legitimately need to soft-delete tens of thousands
  // of rows (e.g. a long-neglected DB where Closed listings piled up); a
  // lone `updateMany` over that many rows — plus a multi-thousand-element
  // `notIn` and dozens of per-row updates — held one transaction/connection
  // open long enough that Render's shared Postgres dropped it mid-flight
  // (P1011 "Error opening a TLS connection: unexpected EOF"), failing the
  // whole nightly. Chunking keeps each statement small and fast.
  //
  // Atomicity isn't needed here: the offboard set (keys NOT live) and the
  // resurrect set (keys live) are disjoint, and the whole sweep is
  // idempotent — a partial run just does less and the next nightly finishes
  // the rest.
  const CHUNK = 2_000;
  const chunk = <T>(arr: T[]): T[][] => {
    const out: T[][] = [];
    for (let i = 0; i < arr.length; i += CHUNK) out.push(arr.slice(i, i + CHUNK));
    return out;
  };

  // 1. Resurrect + bump lastSeenAt on every live key. Chunked so the
  //    `in (...)` clause stays small.
  let bumped = 0;
  for (const keys of chunk(liveKeysArr)) {
    const res = await db.listing.updateMany({
      where: { mlsId: { in: keys } },
      data: { lastSeenAt: sweepStartedAt, deletedAt: null },
    });
    bumped += res.count;
  }

  // 2. Soft-delete stale listings. Select the ids first (read-only, cheap),
  //    then update in chunks. Live keys are excluded via `notIn`; the
  //    lastSeenAt guard exempts anything etl-sync upserted this nightly but
  //    the Active-keys scan missed to a paging artifact.
  const staleRows = await db.listing.findMany({
    where: {
      mlsId: { notIn: liveKeysArr },
      deletedAt: null,
      OR: [{ lastSeenAt: null }, { lastSeenAt: { lt: seenCutoff } }],
    },
    select: { mlsId: true },
  });
  let offboarded = 0;
  for (const rows of chunk(staleRows)) {
    const res = await db.listing.updateMany({
      where: { mlsId: { in: rows.map((r) => r.mlsId) } },
      data: { deletedAt: sweepStartedAt },
    });
    offboarded += res.count;
  }

  // 3. Per-row transition writes so we can also store the new status; tiny
  //    set in practice (~tens of rows/day). Runs last so a same-key
  //    Active↔terminal flip lands on the terminal state.
  for (const r of localTransitioned) {
    await db.listing.update({
      where: { mlsId: r.mlsId },
      data: {
        deletedAt: sweepStartedAt,
        status: transitioned.get(r.mlsId) ?? undefined,
      },
    });
  }

  console.log(
    `[offboard] done — offboarded=${offboarded}, transition-offboarded=${localTransitioned.length}, resurrected=${resurrectingCount}, bumped lastSeenAt=${bumped}, total live keys=${liveKeys.size}`,
  );
}

main()
  .catch((err) => {
    console.error("[offboard] failed:", err);
    process.exit(1);
  })
  .finally(() => db.$disconnect());
