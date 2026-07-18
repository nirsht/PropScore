/**
 * One-off: recompute heuristic scores for every Listing using the current
 * weights and current normalize.ts logic. Touches only the heuristic
 * columns of Score (densityScore, vacancyScore, motivationScore,
 * valueAddWeightedAvg, breakdown, computedBy, computedAt). AI columns
 * (ai*) are written exclusively by `runAIScoring` and are left untouched
 * here so the UI can sort by either source independently.
 *
 * Also re-derives sqft/units/etc. by re-running normalize against `raw`,
 * so changes to "0 → null" coercion propagate.
 *
 * Usage: pnpm recompute:scores
 */
import { db } from "@/lib/db";
import { loadCalibrations } from "@/server/etl/scoring/calibration";
import { recomputeListingScore, type RecomputeDelta } from "@/server/etl/recomputeListing";
import { mapWithConcurrency } from "@/lib/concurrency";

const BATCH = 500;
const CONCURRENCY = 10;

async function main() {
  const total = await db.listing.count();
  console.log(`[recompute] total listings: ${total}`);

  // User calibrations are a small set; load once and reuse for every listing.
  const calibrations = await loadCalibrations(db);
  console.log(`[recompute] loaded ${calibrations.length} location calibration(s)`);

  let cursor: string | undefined;
  let processed = 0;
  let scored = 0;
  let updatedListing = 0;
  let locationUpdated = 0;

  while (true) {
    const batch = await db.listing.findMany({
      take: BATCH,
      ...(cursor ? { skip: 1, cursor: { mlsId: cursor } } : {}),
      orderBy: { mlsId: "asc" },
      include: { score: true, neighborhoodRel: true },
    });
    if (batch.length === 0) break;

    const results = await mapWithConcurrency(
      batch,
      CONCURRENCY,
      (l): Promise<RecomputeDelta> => recomputeListingScore(db, l, calibrations),
    );

    for (let i = 0; i < results.length; i++) {
      processed += 1;
      const r = results[i]!;
      if (r.status === "fulfilled") {
        if (r.value.updatedListing) updatedListing += 1;
        if (r.value.locationUpdated) locationUpdated += 1;
        if (r.value.scored) scored += 1;
      } else {
        console.error(`[recompute] mlsId=${batch[i]!.mlsId}:`, r.reason);
      }
    }

    cursor = batch[batch.length - 1]?.mlsId;
    console.log(
      `[recompute] processed=${processed}/${total}, scored=${scored}, normalizedFieldUpdates=${updatedListing}, locationUpdated=${locationUpdated}`,
    );
  }

  console.log(`[recompute] refreshing materialized view…`);
  await db.$executeRawUnsafe(`REFRESH MATERIALIZED VIEW CONCURRENTLY "mv_listing_search"`);

  console.log(
    `[recompute] done — processed=${processed}, scored=${scored}, normalizedFieldUpdates=${updatedListing}, locationUpdated=${locationUpdated}`,
  );
}

main()
  .catch((err) => {
    console.error("[recompute] failed:", err);
    process.exit(1);
  })
  .finally(() => db.$disconnect());
