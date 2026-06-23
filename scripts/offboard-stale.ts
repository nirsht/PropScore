/**
 * Offboard listings that have fallen off Bridge.
 *
 * Strategy:
 *   1. Pull every ListingKey currently Active in Bridge (lightweight —
 *      `$select=ListingKey` only, ~15 paged requests for ~3k listings).
 *   2. Mark `deletedAt = now()` on any local Active listing whose
 *      ListingKey is NOT in that set AND whose `lastSeenAt` predates the
 *      start of this sweep (the "missing for 2+ syncs" guard — a listing
 *      that just got upserted in this same nightly can't be offboarded).
 *   3. Resurrect any local listing whose ListingKey IS in the set but
 *      whose `deletedAt` is set (e.g., the listing reappeared in Bridge).
 *
 * Forensic data (scores, enrichments, contacts, chats, emails, documents)
 * is preserved — this is a soft-delete via the `deletedAt` column only.
 *
 * Idempotent: re-running with no new disappearances marks zero rows.
 *
 * Usage: `pnpm offboard:stale` or `pnpm offboard:stale -- --dry-run`.
 */
import { db } from "@/lib/db";
import { searchProperties, type BridgeProperty } from "@/server/etl/bridge-client";

const dryRun = process.argv.includes("--dry-run");

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

  // ---- 2. Mark stale ----
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
      `[offboard] DRY-RUN — would offboard=${wouldOffboard}, would resurrect=${wouldResurrect}, alive=${alive}`,
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

  const [offboarded, bumped] = await db.$transaction([
    db.listing.updateMany({
      where: {
        mlsId: { notIn: liveKeysArr },
        deletedAt: null,
        // "Missing for 2+ syncs" guard. A listing upserted by etl-sync
        // within this same nightly has lastSeenAt >= seenCutoff and is
        // exempt.
        OR: [{ lastSeenAt: null }, { lastSeenAt: { lt: seenCutoff } }],
      },
      data: { deletedAt: sweepStartedAt },
    }),
    db.listing.updateMany({
      where: { mlsId: { in: liveKeysArr } },
      data: { lastSeenAt: sweepStartedAt, deletedAt: null },
    }),
  ]);

  console.log(
    `[offboard] done — offboarded=${offboarded.count}, resurrected=${resurrectingCount}, bumped lastSeenAt=${bumped.count}, total live keys=${liveKeys.size}`,
  );
}

main()
  .catch((err) => {
    console.error("[offboard] failed:", err);
    process.exit(1);
  })
  .finally(() => db.$disconnect());
