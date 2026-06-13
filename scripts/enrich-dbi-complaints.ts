/**
 * Enrich every SF Listing with its parcel's DBI Inspection Complaints summary
 * from Socrata 9c7e-yn3d. Idempotent + resumable: only touches rows where
 * `dbiComplaintsFetchedAt IS NULL` (or `--force`).
 *
 * Joins on `Listing.blockLot` (populated by `enrich:sfpim`). Listings without
 * blockLot are stamped as fetched with zero counts so they don't keep
 * re-trying — they'll be re-fetched once `--force` is used after sfpim runs.
 *
 * Usage:
 *   pnpm enrich:dbi-complaints                  # full sweep, concurrency 3
 *   pnpm enrich:dbi-complaints --limit=50
 *   pnpm enrich:dbi-complaints --concurrency=2
 *   pnpm enrich:dbi-complaints --force          # re-fetch even if populated
 */
import { db } from "@/lib/db";
import { fetchByBlockLot } from "@/server/etl/dbi-complaints-client";
import { mapWithConcurrency } from "@/lib/concurrency";

const args = process.argv.slice(2);
const limitArg = args.find((a) => a.startsWith("--limit="));
const limit = limitArg ? Number(limitArg.split("=")[1]) : undefined;
const concurrencyArg = args.find((a) => a.startsWith("--concurrency="));
const concurrency = concurrencyArg
  ? Math.max(1, Math.min(20, Number(concurrencyArg.split("=")[1])))
  : 3;
const force = args.includes("--force");

async function main() {
  const where = {
    city: "San Francisco",
    blockLot: { not: null },
    ...(force ? {} : { dbiComplaintsFetchedAt: null }),
  };

  const total = await db.listing.count({ where });
  console.log(
    `[dbi-complaints] candidates: ${total}${limit ? ` (limited to ${limit})` : ""}${force ? " (force)" : ""} concurrency=${concurrency}`,
  );

  let processed = 0;
  let matched = 0;
  let skipped = 0;
  let errored = 0;
  let cursor: string | undefined;
  const cap = limit ?? Number.POSITIVE_INFINITY;
  const BATCH = 100;

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

    const started = Date.now();
    const results = await mapWithConcurrency(batch, concurrency, async (l) => {
      if (!l.blockLot) {
        await db.listing.update({
          where: { mlsId: l.mlsId },
          data: { dbiComplaintsFetchedAt: new Date() },
        });
        return "skipped" as const;
      }
      const summary = await fetchByBlockLot(l.blockLot);
      await db.listing.update({
        where: { mlsId: l.mlsId },
        data: {
          dbiComplaintsOpenCount: summary.openCount,
          dbiComplaintsRecentCount: summary.recentCount,
          dbiComplaintsLatest: summary.latest ?? undefined,
          dbiComplaintsFetchedAt: new Date(),
        },
      });
      return summary.openCount > 0 || summary.recentCount > 0
        ? ("matched" as const)
        : ("skipped" as const);
    });

    for (let i = 0; i < results.length; i++) {
      processed += 1;
      const r = results[i]!;
      if (r.status === "fulfilled") {
        if (r.value === "matched") matched += 1;
        else skipped += 1;
      } else {
        errored += 1;
        console.error(
          `[dbi-complaints] mlsId=${batch[i]!.mlsId} blockLot=${batch[i]!.blockLot}:`,
          r.reason,
        );
      }
    }

    cursor = batch[batch.length - 1]?.mlsId;
    const dur = ((Date.now() - started) / 1000).toFixed(1);
    console.log(
      `[dbi-complaints] processed=${processed}/${total}, matched=${matched}, skipped=${skipped}, errored=${errored} (batch ${dur}s)`,
    );
  }

  console.log(
    `[dbi-complaints] done — processed=${processed}, matched=${matched}, skipped=${skipped}, errored=${errored}`,
  );
}

main()
  .catch((err) => {
    console.error("[dbi-complaints] failed:", err);
    process.exit(1);
  })
  .finally(() => db.$disconnect());
