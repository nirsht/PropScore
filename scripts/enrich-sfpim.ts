/**
 * Enrich every SF Listing with the Assessor's record from the Socrata
 * Secured Property Tax Roll dataset (wv5m-vpq2). Idempotent + resumable:
 * only touches rows where `assessorFetchedAt IS NULL` (or `--force` is passed).
 *
 * Usage:
 *   pnpm tsx scripts/enrich-sfpim.ts                  # full sweep, concurrency 10
 *   pnpm tsx scripts/enrich-sfpim.ts --limit=50       # cap rows this run
 *   pnpm tsx scripts/enrich-sfpim.ts --concurrency=5  # back off
 *   pnpm tsx scripts/enrich-sfpim.ts --force          # re-fetch even if already populated
 */
import { db } from "@/lib/db";
import { enrichListingSfpimRow } from "@/server/etl/sfpim-enrich";
import { mapWithConcurrency } from "@/lib/concurrency";

const args = process.argv.slice(2);
const limitArg = args.find((a) => a.startsWith("--limit="));
const limit = limitArg ? Number(limitArg.split("=")[1]) : undefined;
const concurrencyArg = args.find((a) => a.startsWith("--concurrency="));
const concurrency = concurrencyArg
  ? Math.max(1, Math.min(20, Number(concurrencyArg.split("=")[1])))
  : 10;
const force = args.includes("--force");

async function main() {
  const where = {
    city: "San Francisco",
    // Skip listings Bridge has stopped showing (soft-deleted by
    // offboard:stale). They were ~30% of the candidate set and nothing reads
    // their enrichment. A re-listed row has deletedAt cleared by etl:sync
    // while its *FetchedAt stays null, so it re-enters scope on its own.
    deletedAt: null,
    ...(force ? {} : { assessorFetchedAt: null }),
  };

  const total = await db.listing.count({ where });
  console.log(
    `[sfpim] candidates: ${total}${limit ? ` (limited to ${limit})` : ""}${force ? " (force)" : ""} concurrency=${concurrency}`,
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
      select: {
        mlsId: true,
        address: true,
        sqft: true,
        units: true,
        raw: true,
      },
    });
    if (batch.length === 0) break;

    const started = Date.now();
    const results = await mapWithConcurrency(batch, concurrency, (l) =>
      enrichListingSfpimRow(l),
    );

    for (let i = 0; i < results.length; i++) {
      processed += 1;
      const r = results[i]!;
      if (r.status === "fulfilled") {
        if (r.value === "matched") matched += 1;
        else skipped += 1;
      } else {
        errored += 1;
        console.error(`[sfpim] mlsId=${batch[i]!.mlsId} address="${batch[i]!.address}":`, r.reason);
      }
    }

    cursor = batch[batch.length - 1]?.mlsId;
    const dur = ((Date.now() - started) / 1000).toFixed(1);
    console.log(
      `[sfpim] processed=${processed}/${total}, matched=${matched}, skipped=${skipped}, errored=${errored} (batch ${dur}s)`,
    );
  }

  console.log(`[sfpim] refreshing materialized view…`);
  await db.$executeRawUnsafe(
    `REFRESH MATERIALIZED VIEW CONCURRENTLY "mv_listing_search"`,
  );

  console.log(
    `[sfpim] done — processed=${processed}, matched=${matched}, skipped=${skipped}, errored=${errored}`,
  );
}

main()
  .catch((err) => {
    console.error("[sfpim] failed:", err);
    process.exit(1);
  })
  .finally(() => db.$disconnect());
