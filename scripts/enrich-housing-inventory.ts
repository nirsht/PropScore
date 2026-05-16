/**
 * Enrich every SF Listing with the last 5 years of net unit change on its
 * parcel from the SF Housing Inventory dataset (Socrata 6v9b-p59r).
 * Idempotent + resumable: only touches rows where
 * `housingInventoryFetchedAt IS NULL` (or `--force`).
 *
 * Joins on `Listing.blockLot` (populated by `enrich:sfpim`). Listings without
 * blockLot are stamped as fetched with zero net change.
 *
 * Usage:
 *   pnpm enrich:housing-inventory                  # full sweep, concurrency 3
 *   pnpm enrich:housing-inventory --limit=50
 *   pnpm enrich:housing-inventory --concurrency=2
 *   pnpm enrich:housing-inventory --force
 */
import { db } from "@/lib/db";
import { fetchByBlockLot } from "@/server/etl/housing-inventory-client";
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
    ...(force ? {} : { housingInventoryFetchedAt: null }),
  };

  const total = await db.listing.count({ where });
  console.log(
    `[housing-inventory] candidates: ${total}${limit ? ` (limited to ${limit})` : ""}${force ? " (force)" : ""} concurrency=${concurrency}`,
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
          data: { housingInventoryFetchedAt: new Date() },
        });
        return "skipped" as const;
      }
      const summary = await fetchByBlockLot(l.blockLot);
      await db.listing.update({
        where: { mlsId: l.mlsId },
        data: {
          housingNetUnitChange5y: summary.netUnitChange5y,
          housingInventoryFetchedAt: new Date(),
        },
      });
      return summary.netUnitChange5y !== 0 ? ("matched" as const) : ("skipped" as const);
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
          `[housing-inventory] mlsId=${batch[i]!.mlsId} blockLot=${batch[i]!.blockLot}:`,
          r.reason,
        );
      }
    }

    cursor = batch[batch.length - 1]?.mlsId;
    const dur = ((Date.now() - started) / 1000).toFixed(1);
    console.log(
      `[housing-inventory] processed=${processed}/${total}, matched=${matched}, skipped=${skipped}, errored=${errored} (batch ${dur}s)`,
    );
  }

  console.log(
    `[housing-inventory] done — processed=${processed}, matched=${matched}, skipped=${skipped}, errored=${errored}`,
  );
}

main()
  .catch((err) => {
    console.error("[housing-inventory] failed:", err);
    process.exit(1);
  })
  .finally(() => db.$disconnect());
