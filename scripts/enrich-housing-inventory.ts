/**
 * Enrich every SF Listing with its parcel's net housing-unit change over the
 * last 5 reporting years, from Socrata xdht-4php.
 * Idempotent + resumable: only touches rows where
 * `housingInventoryFetchedAt IS NULL` (or `--force`).
 *
 * Joins on `Listing.blockLot` (populated by `enrich:sfpim`).
 *
 * Fetching is batched by parcel id. This dataset exposes a single `blocklot`
 * column (no separate block/lot), so unlike the NOV/complaint feeds we cannot
 * widen to a whole block — but `blocklot IN (…)` still collapses 100 parcels
 * into one request. Since the Socrata client throttles globally to ~1 req/1.1s,
 * request count is what sets wall-clock: one request per parcel meant 74.5k
 * requests ≈ 22.8 hours, versus ~317 requests (≈6 min) for the ~31.6k distinct
 * blockLots in the candidate set. Parcels are processed in waves so only one
 * wave of summaries is resident at a time.
 *
 * Usage:
 *   pnpm enrich:housing-inventory                  # full sweep
 *   pnpm enrich:housing-inventory --limit=50
 *   pnpm enrich:housing-inventory --force          # re-fetch even if populated
 */
import { db } from "@/lib/db";
import { fetchByBlockLots } from "@/server/etl/housing-inventory-client";
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

/** Distinct parcels per fetch+writeback wave. At 100/request this is 5 requests. */
const BLOCKLOTS_PER_WAVE = 500;

async function main() {
  const where = {
    city: "San Francisco",
    blockLot: { not: null },
    // Skip listings Bridge has stopped showing (offboard:stale soft-deletes
    // them). They were ~30% of the candidate set and their enrichment is
    // never read. A re-listed row gets deletedAt cleared by etl:sync and its
    // *FetchedAt is still null, so it comes back into scope automatically.
    deletedAt: null,
    ...(force ? {} : { housingInventoryFetchedAt: null }),
  };

  const total = await db.listing.count({ where });

  // Load candidate (mlsId, blockLot) pairs up front and group by parcel, so
  // each distinct blockLot is fetched exactly once even though many listings
  // (condos) share one.
  const candidates = await db.listing.findMany({
    where,
    select: { mlsId: true, blockLot: true },
    orderBy: { blockLot: "asc" },
    ...(limit ? { take: limit } : {}),
  });

  const byBlockLot = new Map<string, string[]>();
  for (const c of candidates) {
    if (!c.blockLot) continue;
    const bucket = byBlockLot.get(c.blockLot);
    if (bucket) bucket.push(c.mlsId);
    else byBlockLot.set(c.blockLot, [c.mlsId]);
  }

  const blockLots = [...byBlockLot.keys()];
  console.log(
    `[housing-inventory] candidates: ${total}${limit ? ` (limited to ${limit})` : ""}${force ? " (force)" : ""} across ${blockLots.length} parcels`,
  );

  let processed = 0;
  let matched = 0;
  let skipped = 0;
  let errored = 0;

  for (let i = 0; i < blockLots.length; i += BLOCKLOTS_PER_WAVE) {
    const wave = blockLots.slice(i, i + BLOCKLOTS_PER_WAVE);
    const started = Date.now();

    let summaries: Awaited<ReturnType<typeof fetchByBlockLots>>;
    try {
      summaries = await fetchByBlockLots(wave);
    } catch (err) {
      // A whole wave failing is worth surfacing but not fatal — the listings
      // keep their null fetchedAt and are retried on the next run.
      errored += wave.reduce((n, bl) => n + (byBlockLot.get(bl)?.length ?? 0), 0);
      console.error(
        `[housing-inventory] wave ${wave[0]}..${wave[wave.length - 1]} failed:`,
        err,
      );
      continue;
    }

    const pairs = wave.flatMap((bl) =>
      (byBlockLot.get(bl) ?? []).map((mlsId) => ({ mlsId, blockLot: bl })),
    );
    const results = await mapWithConcurrency(pairs, concurrency, async (l) => {
      // Most parcels have no housing-production history at all; that is a
      // net change of 0, and still counts as "fetched" — same as the previous
      // per-parcel behaviour.
      const netUnitChange5y = summaries.get(l.blockLot)?.netUnitChange5y ?? 0;
      await db.listing.update({
        where: { mlsId: l.mlsId },
        data: {
          housingNetUnitChange5y: netUnitChange5y,
          housingInventoryFetchedAt: new Date(),
        },
      });
      return netUnitChange5y !== 0 ? ("matched" as const) : ("skipped" as const);
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
          `[housing-inventory] mlsId=${pairs[j]!.mlsId} blockLot=${pairs[j]!.blockLot}:`,
          r.reason,
        );
      }
    }

    const dur = ((Date.now() - started) / 1000).toFixed(1);
    console.log(
      `[housing-inventory] parcels=${Math.min(i + BLOCKLOTS_PER_WAVE, blockLots.length)}/${blockLots.length}, processed=${processed}, matched=${matched}, skipped=${skipped}, errored=${errored} (wave ${dur}s)`,
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
