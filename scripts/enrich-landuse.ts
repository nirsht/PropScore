/**
 * Enrich every SF Listing with its parcel's Land Use category from Socrata
 * fdfd-xptc. Idempotent + resumable: only touches rows where
 * `landUseFetchedAt IS NULL` (or `--force`).
 *
 * Joins on `Listing.blockLot == mapblklot` (the canonical 7-char SF parcel
 * ID), populated by `enrich:sfpim`. Listings without `blockLot` are skipped
 * (they'll match once sfpim runs).
 *
 * Usage:
 *   pnpm enrich:landuse                  # full sweep, concurrency 4
 *   pnpm enrich:landuse --limit=50
 *   pnpm enrich:landuse --concurrency=2
 *   pnpm enrich:landuse --force          # re-fetch even if populated
 */
import { db } from "@/lib/db";
import { fetchByBlockLot } from "@/server/etl/landuse-client";
import { mapWithConcurrency } from "@/lib/concurrency";

const args = process.argv.slice(2);
const limitArg = args.find((a) => a.startsWith("--limit="));
const limit = limitArg ? Number(limitArg.split("=")[1]) : undefined;
const concurrencyArg = args.find((a) => a.startsWith("--concurrency="));
const concurrency = concurrencyArg
  ? Math.max(1, Math.min(20, Number(concurrencyArg.split("=")[1])))
  : 4;
const force = args.includes("--force");

async function main() {
  const where = {
    city: "San Francisco",
    blockLot: { not: null },
    ...(force ? {} : { landUseFetchedAt: null }),
  };

  const total = await db.listing.count({ where });
  console.log(
    `[landuse] candidates: ${total}${limit ? ` (limited to ${limit})` : ""}${force ? " (force)" : ""} concurrency=${concurrency}`,
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
          data: { landUseFetchedAt: new Date() },
        });
        return "skipped" as const;
      }
      const record = await fetchByBlockLot(l.blockLot);
      if (!record) {
        await db.listing.update({
          where: { mlsId: l.mlsId },
          data: { landUseFetchedAt: new Date() },
        });
        return "skipped" as const;
      }
      await db.listing.update({
        where: { mlsId: l.mlsId },
        data: {
          landUseCategory: record.category,
          landUseResUnits: record.resUnits,
          landUseResSqft: record.resSqft,
          landUseCommSqft: record.commSqft,
          landUseFetchedAt: new Date(),
        },
      });
      return "matched" as const;
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
          `[landuse] mlsId=${batch[i]!.mlsId} blockLot=${batch[i]!.blockLot}:`,
          r.reason,
        );
      }
    }

    cursor = batch[batch.length - 1]?.mlsId;
    const dur = ((Date.now() - started) / 1000).toFixed(1);
    console.log(
      `[landuse] processed=${processed}/${total}, matched=${matched}, skipped=${skipped}, errored=${errored} (batch ${dur}s)`,
    );
  }

  console.log(
    `[landuse] done — processed=${processed}, matched=${matched}, skipped=${skipped}, errored=${errored}`,
  );
}

main()
  .catch((err) => {
    console.error("[landuse] failed:", err);
    process.exit(1);
  })
  .finally(() => db.$disconnect());
