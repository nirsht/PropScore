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

  // Per-row transition writes so we can also store the new status; tiny
  // set in practice (~tens of rows/day), so we don't bother batching.
  const transitionWrites = localTransitioned.map((r) =>
    db.listing.update({
      where: { mlsId: r.mlsId },
      data: {
        deletedAt: sweepStartedAt,
        status: transitioned.get(r.mlsId) ?? undefined,
      },
    }),
  );

  const txResult = await db.$transaction([
    db.listing.updateMany({
      where: {
        mlsId: { notIn: liveKeysArr },
        deletedAt: null,
        // A listing upserted by etl-sync within this same nightly has
        // lastSeenAt >= seenCutoff and is exempt from the "missing"
        // rule. Status-transition offboards above already handled the
        // same-nightly Pending/Closed case.
        OR: [{ lastSeenAt: null }, { lastSeenAt: { lt: seenCutoff } }],
      },
      data: { deletedAt: sweepStartedAt },
    }),
    db.listing.updateMany({
      where: { mlsId: { in: liveKeysArr } },
      data: { lastSeenAt: sweepStartedAt, deletedAt: null },
    }),
    ...transitionWrites,
  ]);
  const [offboarded, bumped] = txResult as [
    { count: number },
    { count: number },
    ...unknown[],
  ];

  console.log(
    `[offboard] done — offboarded=${offboarded.count}, transition-offboarded=${transitionWrites.length}, resurrected=${resurrectingCount}, bumped lastSeenAt=${bumped.count}, total live keys=${liveKeys.size}`,
  );
}

main()
  .catch((err) => {
    console.error("[offboard] failed:", err);
    process.exit(1);
  })
  .finally(() => db.$disconnect());
