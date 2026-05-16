/**
 * Tag every SF Listing with its soft-story status from Socrata jwdp-cqyc.
 *
 * Unlike the per-parcel NOV fetcher, this script preloads the entire ~5k-row
 * soft-story dataset into memory once and then bulk-tags listings — one DB
 * pass, zero per-listing Socrata calls. Idempotent + resumable: only touches
 * rows where `softStoryFetchedAt IS NULL` (or `--force`).
 *
 * Joins on `Listing.blockLot` (populated by `enrich:sfpim`). Listings without
 * blockLot are stamped as fetched with `softStoryRedFlag = null` (unknown) so
 * they don't keep re-trying — they'll be re-evaluated once `--force` is used
 * after a sfpim sweep.
 *
 * Y/N semantics:
 *   - true  → on the soft-story list AND retrofit not yet complete
 *   - false → not on the list, OR on the list with retrofit complete
 *   - null  → no blockLot, can't decide
 *
 * Usage:
 *   pnpm enrich:soft-story                # rows that haven't been computed yet
 *   pnpm enrich:soft-story --force        # recompute all
 *   pnpm enrich:soft-story --limit=100
 */
import { db } from "@/lib/db";
import { fetchAllSoftStoryRecords } from "@/server/etl/soft-story-client";

const args = process.argv.slice(2);
const limitArg = args.find((a) => a.startsWith("--limit="));
const limit = limitArg ? Number(limitArg.split("=")[1]) : undefined;
const force = args.includes("--force");

async function main() {
  console.log("[soft-story] fetching SF soft-story dataset…");
  const softStoryMap = await fetchAllSoftStoryRecords();
  console.log(`[soft-story] dataset rows: ${softStoryMap.size}`);

  const where = {
    city: "San Francisco",
    ...(force ? {} : { softStoryFetchedAt: null }),
  };

  const total = await db.listing.count({ where });
  console.log(
    `[soft-story] candidates: ${total}${limit ? ` (limited to ${limit})` : ""}${force ? " (force)" : ""}`,
  );

  let processed = 0;
  let redFlag = 0;
  let onListButOk = 0;
  let notListed = 0;
  let unknown = 0;
  let cursor: string | undefined;
  const cap = limit ?? Number.POSITIVE_INFINITY;
  const BATCH = 500;

  while (processed < cap) {
    const remaining = Math.min(BATCH, cap - processed);
    const batch = await db.listing.findMany({
      where,
      take: remaining,
      ...(cursor ? { skip: 1, cursor: { mlsId: cursor } } : {}),
      orderBy: { mlsId: "asc" },
      select: { mlsId: true, blockLot: true },
    });
    if (batch.length === 0) break;

    const now = new Date();
    const unknownIds: string[] = [];
    const notListedIds: string[] = [];
    const listedGroups = new Map<
      string,
      { flag: boolean; tier: number | null; status: string | null; ids: string[] }
    >();

    for (const l of batch) {
      if (!l.blockLot) {
        unknownIds.push(l.mlsId);
        continue;
      }
      const record = softStoryMap.get(l.blockLot);
      if (!record) {
        notListedIds.push(l.mlsId);
        continue;
      }
      const flag = !record.retrofitted;
      const key = `${flag}|${record.tier ?? ""}|${record.status ?? ""}`;
      let group = listedGroups.get(key);
      if (!group) {
        group = { flag, tier: record.tier, status: record.status, ids: [] };
        listedGroups.set(key, group);
      }
      group.ids.push(l.mlsId);
    }

    if (unknownIds.length > 0) {
      await db.listing.updateMany({
        where: { mlsId: { in: unknownIds } },
        data: { softStoryFetchedAt: now },
      });
      unknown += unknownIds.length;
    }
    if (notListedIds.length > 0) {
      await db.listing.updateMany({
        where: { mlsId: { in: notListedIds } },
        data: {
          softStoryRedFlag: false,
          softStoryTier: null,
          softStoryStatus: null,
          softStoryFetchedAt: now,
        },
      });
      notListed += notListedIds.length;
    }
    for (const group of listedGroups.values()) {
      await db.listing.updateMany({
        where: { mlsId: { in: group.ids } },
        data: {
          softStoryRedFlag: group.flag,
          softStoryTier: group.tier,
          softStoryStatus: group.status,
          softStoryFetchedAt: now,
        },
      });
      if (group.flag) redFlag += group.ids.length;
      else onListButOk += group.ids.length;
    }

    processed += batch.length;
    cursor = batch[batch.length - 1]?.mlsId;
    console.log(
      `[soft-story] processed=${processed}/${total}, redFlag=${redFlag}, onListButOk=${onListButOk}, notListed=${notListed}, unknown=${unknown}`,
    );
  }

  console.log(
    `[soft-story] done — processed=${processed}, redFlag=${redFlag}, onListButOk=${onListButOk}, notListed=${notListed}, unknown=${unknown}`,
  );
  console.log(
    `[soft-story] reminder: refresh MV with` +
      ` 'REFRESH MATERIALIZED VIEW CONCURRENTLY mv_listing_search'`,
  );
}

main()
  .catch((err) => {
    console.error("[soft-story] failed:", err);
    process.exit(1);
  })
  .finally(() => db.$disconnect());
