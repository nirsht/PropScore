/**
 * Enrich every SF Listing with the Assessor's record from the Socrata
 * SF-PIM dataset (i8ew-h6z7). Idempotent + resumable: only touches rows
 * where `assessorFetchedAt IS NULL` (or `--force` is passed).
 *
 * Usage:
 *   pnpm tsx scripts/enrich-sfpim.ts            # full sweep
 *   pnpm tsx scripts/enrich-sfpim.ts --limit=50 # cap rows this run
 *   pnpm tsx scripts/enrich-sfpim.ts --force    # re-fetch even if already populated
 */
import { db } from "@/lib/db";
import type { Prisma } from "@prisma/client";
import { searchByAddress } from "@/server/etl/sfpim-client";

const args = process.argv.slice(2);
const limitArg = args.find((a) => a.startsWith("--limit="));
const limit = limitArg ? Number(limitArg.split("=")[1]) : undefined;
const force = args.includes("--force");

async function main() {
  const where = {
    city: "San Francisco",
    ...(force ? {} : { assessorFetchedAt: null }),
  };

  const total = await db.listing.count({ where });
  console.log(
    `[sfpim] candidates: ${total}${limit ? ` (limited to ${limit})` : ""}${force ? " (force)" : ""}`,
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
      select: { mlsId: true, address: true, raw: true },
    });
    if (batch.length === 0) break;

    for (const l of batch) {
      processed += 1;
      try {
        const record = await searchByAddress(l.address);
        if (!record) {
          await db.listing.update({
            where: { mlsId: l.mlsId },
            data: { assessorFetchedAt: new Date() },
          });
          skipped += 1;
          continue;
        }

        // Persist the full assessor row alongside the rest of `raw` so it's
        // there for ad-hoc debugging without a second round-trip.
        const raw = (l.raw ?? {}) as Record<string, unknown>;
        const mergedRaw: Prisma.InputJsonValue = {
          ...raw,
          assessor: record.raw as unknown as Prisma.InputJsonValue,
        };

        await db.listing.update({
          where: { mlsId: l.mlsId },
          data: {
            blockLot: record.blockLot,
            block: record.block,
            lot: record.lot,
            assessorBuildingSqft: record.buildingSqft,
            assessorLotSqft: record.lotSqft,
            assessorYearBuilt: record.yearBuilt,
            assessorStories: record.stories,
            assessorUnits: record.units,
            assessorRooms: record.rooms,
            assessorBedrooms: record.bedrooms,
            assessorBathrooms: record.bathrooms,
            assessorUseType: record.useType,
            assessorConstructionType: record.constructionType,
            assessorBasement: record.basement,
            assessorFetchedAt: new Date(),
            raw: mergedRaw,
          },
        });
        matched += 1;
      } catch (err) {
        errored += 1;
        console.error(`[sfpim] mlsId=${l.mlsId} address="${l.address}":`, err);
      }
    }

    cursor = batch[batch.length - 1]?.mlsId;
    console.log(
      `[sfpim] processed=${processed}/${total}, matched=${matched}, skipped=${skipped}, errored=${errored}`,
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
