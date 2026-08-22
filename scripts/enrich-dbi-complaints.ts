/**
 * Enrich every SF Listing with its parcel's DBI Inspection Complaints summary
 * from Socrata 9c7e-yn3d. Idempotent + resumable: only touches rows where
 * `dbiComplaintsFetchedAt IS NULL` (or `--force`).
 *
 * Joins on `Listing.blockLot` (populated by `enrich:sfpim`).
 *
 * Fetching is batched by *block*, not by parcel. The Socrata client throttles
 * globally to ~1 req/1.1s, so request count is the only thing that sets
 * wall-clock: one request per parcel meant 74.5k requests ≈ 22.8 hours, which
 * is why the daily cron never got past this lane inside its 12h budget. The
 * candidate set collapses to ~4.1k distinct blocks, and a block-level query
 * returns every lot on the block, so the same coverage costs ~165 requests
 * (≈3 min). Blocks are fetched in waves so only one wave of summaries is
 * resident at a time.
 *
 * Usage:
 *   pnpm enrich:dbi-complaints                  # full sweep
 *   pnpm enrich:dbi-complaints --limit=50
 *   pnpm enrich:dbi-complaints --force          # re-fetch even if populated
 */
import { db } from "@/lib/db";
import { fetchByBlocks, emptyComplaintSummary } from "@/server/etl/dbi-complaints-client";
import { mapWithConcurrency } from "@/lib/concurrency";

const args = process.argv.slice(2);
const limitArg = args.find((a) => a.startsWith("--limit="));
const limit = limitArg ? Number(limitArg.split("=")[1]) : undefined;
const concurrencyArg = args.find((a) => a.startsWith("--concurrency="));
// Concurrency now only governs the DB writeback — the Socrata side is a single
// serialized batch fetch per wave.
const concurrency = concurrencyArg
  ? Math.max(1, Math.min(20, Number(concurrencyArg.split("=")[1])))
  : 3;
const force = args.includes("--force");

/** Blocks per fetch+writeback wave. At 25 blocks/request this is 4 requests. */
const BLOCKS_PER_WAVE = 100;

async function main() {
  const where = {
    city: "San Francisco",
    blockLot: { not: null },
    // Skip listings Bridge has stopped showing (offboard:stale soft-deletes
    // them). They were ~30% of the candidate set and their enrichment is
    // never read. A re-listed row gets deletedAt cleared by etl:sync and its
    // *FetchedAt is still null, so it comes back into scope automatically.
    deletedAt: null,
    ...(force ? {} : { dbiComplaintsFetchedAt: null }),
  };

  const total = await db.listing.count({ where });

  // Load the candidate (mlsId, blockLot) pairs up front and group by block.
  // ~52k rows of two short strings — a few MB, and it lets every block be
  // fetched exactly once regardless of mlsId ordering.
  const candidates = await db.listing.findMany({
    where,
    select: { mlsId: true, blockLot: true },
    orderBy: { blockLot: "asc" },
    ...(limit ? { take: limit } : {}),
  });

  const byBlock = new Map<string, Array<{ mlsId: string; blockLot: string }>>();
  for (const c of candidates) {
    if (!c.blockLot || c.blockLot.length < 7) continue;
    const block = c.blockLot.slice(0, 4);
    const bucket = byBlock.get(block);
    if (bucket) bucket.push({ mlsId: c.mlsId, blockLot: c.blockLot });
    else byBlock.set(block, [{ mlsId: c.mlsId, blockLot: c.blockLot }]);
  }

  const blocks = [...byBlock.keys()];
  console.log(
    `[dbi-complaints] candidates: ${total}${limit ? ` (limited to ${limit})` : ""}${force ? " (force)" : ""} across ${blocks.length} blocks`,
  );

  let processed = 0;
  let matched = 0;
  let skipped = 0;
  let errored = 0;

  for (let i = 0; i < blocks.length; i += BLOCKS_PER_WAVE) {
    const wave = blocks.slice(i, i + BLOCKS_PER_WAVE);
    const started = Date.now();

    let summaries: Awaited<ReturnType<typeof fetchByBlocks>>;
    try {
      summaries = await fetchByBlocks(wave);
    } catch (err) {
      // A whole wave failing is worth surfacing but not fatal — the listings
      // keep their null fetchedAt and are retried on the next run.
      errored += wave.reduce((n, b) => n + (byBlock.get(b)?.length ?? 0), 0);
      console.error(`[dbi-complaints] wave ${wave[0]}..${wave[wave.length - 1]} failed:`, err);
      continue;
    }

    const listings = wave.flatMap((b) => byBlock.get(b) ?? []);
    const results = await mapWithConcurrency(listings, concurrency, async (l) => {
      // A parcel with no complaint history has no entry — that is the common case
      // and still counts as "fetched" (zero counts), matching the previous
      // per-parcel behaviour.
      const summary = summaries.get(l.blockLot) ?? emptyComplaintSummary(l.blockLot);
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

    for (let j = 0; j < results.length; j++) {
      processed += 1;
      const r = results[j]!;
      if (r.status === "fulfilled") {
        if (r.value === "matched") matched += 1;
        else skipped += 1;
      } else {
        errored += 1;
        console.error(
          `[dbi-complaints] mlsId=${listings[j]!.mlsId} blockLot=${listings[j]!.blockLot}:`,
          r.reason,
        );
      }
    }

    const dur = ((Date.now() - started) / 1000).toFixed(1);
    console.log(
      `[dbi-complaints] blocks=${Math.min(i + BLOCKS_PER_WAVE, blocks.length)}/${blocks.length}, processed=${processed}, matched=${matched}, skipped=${skipped}, errored=${errored} (wave ${dur}s)`,
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
