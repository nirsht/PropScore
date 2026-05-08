/**
 * One-off: recompute heuristic scores for every Listing using the current
 * weights and current normalize.ts logic. Skips rows whose Score was
 * computed by AI (those are preserved). Also re-derives sqft/units/etc. by
 * re-running normalize against `raw`, so changes to "0 → null" coercion
 * propagate.
 *
 * Usage: pnpm recompute:scores
 */
import { db } from "@/lib/db";
import { normalizeListing } from "@/server/etl/normalize";
import { computeHeuristicScore } from "@/server/etl/scoring";
import { locationScore } from "@/server/etl/scoring/location";
import { mapWithConcurrency } from "@/lib/concurrency";
import type { Prisma } from "@prisma/client";

const BATCH = 500;
const CONCURRENCY = 10;

async function main() {
  const total = await db.listing.count();
  console.log(`[recompute] total listings: ${total}`);

  let cursor: string | undefined;
  let processed = 0;
  let scored = 0;
  let skippedAI = 0;
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

    type RowDelta = {
      updatedListing: boolean;
      locationUpdated: boolean;
      scored: boolean;
      skippedAI: boolean;
    };

    const results = await mapWithConcurrency(batch, CONCURRENCY, async (l): Promise<RowDelta> => {
      const delta: RowDelta = { updatedListing: false, locationUpdated: false, scored: false, skippedAI: false };
      const raw = l.raw as Record<string, unknown>;
      const norm = normalizeListing(raw);
      if (!norm) return delta;

      // Re-persist normalized fields if they changed (specifically to flip 0 → null)
      const fieldsChanged =
        l.sqft !== norm.sqft ||
        l.units !== norm.units ||
        l.beds !== norm.beds ||
        l.baths !== norm.baths ||
        l.yearBuilt !== norm.yearBuilt ||
        l.stories !== norm.stories;

      if (fieldsChanged) {
        await db.listing.update({
          where: { mlsId: l.mlsId },
          data: {
            sqft: norm.sqft,
            units: norm.units,
            beds: norm.beds,
            baths: norm.baths,
            yearBuilt: norm.yearBuilt,
            stories: norm.stories,
          },
        });
        delta.updatedListing = true;
      }

      // Location score is independent of AI value-add scoring — always
      // recompute when either of its inputs is present, even when we skip
      // the heuristic Score row below.
      const newLocation = locationScore({
        walkScore: l.walkScore,
        neighborhoodScore: l.neighborhoodRel?.crimeScore ?? null,
      });
      if (newLocation !== l.locationScore) {
        await db.listing.update({
          where: { mlsId: l.mlsId },
          data: {
            locationScore: newLocation,
            locationScoreUpdatedAt: new Date(),
          },
        });
        delta.locationUpdated = true;
      }

      if (l.score?.computedBy === "AI") {
        delta.skippedAI = true;
        return delta;
      }

      const um = l.extractedUnitMix as Array<{ count?: number }> | null;
      const extractedUnitsTotal = Array.isArray(um) && um.length
        ? um.reduce((sum, e) => sum + (e.count ?? 0), 0) || null
        : null;

      const s = computeHeuristicScore(norm, {
        effectiveSqft: l.assessorBuildingSqft ?? l.sqft,
        effectiveUnits: l.assessorUnits ?? l.units ?? extractedUnitsTotal,
        effectiveStories: l.assessorStories ?? l.stories ?? l.aiStories,
        renovationLevel: l.renovationLevel,
        mlsSqft: l.sqft,
        assessorSqft: l.assessorBuildingSqft,
        assessorBuildingValue: l.assessorBuildingValue,
        assessorLandValue: l.assessorLandValue,
        extractedOccupancy: l.extractedOccupancy,
        extractedUnitsTotal,
        detachedAduScore: l.detachedAduScore,
        convertedAduScore: l.convertedAduScore,
        locationScore: newLocation,
      });
      await db.score.upsert({
        where: { listingMlsId: l.mlsId },
        create: {
          listingMlsId: l.mlsId,
          densityScore: s.densityScore,
          vacancyScore: s.vacancyScore,
          motivationScore: s.motivationScore,
          locationScore: s.locationScore,
          aduScore: s.aduScore,
          valueAddWeightedAvg: s.valueAddWeightedAvg,
          breakdown: s.breakdown as Prisma.InputJsonValue,
          computedBy: "HEURISTIC",
        },
        update: {
          densityScore: s.densityScore,
          vacancyScore: s.vacancyScore,
          motivationScore: s.motivationScore,
          locationScore: s.locationScore,
          aduScore: s.aduScore,
          valueAddWeightedAvg: s.valueAddWeightedAvg,
          breakdown: s.breakdown as Prisma.InputJsonValue,
          computedBy: "HEURISTIC",
          computedAt: new Date(),
        },
      });
      delta.scored = true;
      return delta;
    });

    for (let i = 0; i < results.length; i++) {
      processed += 1;
      const r = results[i]!;
      if (r.status === "fulfilled") {
        if (r.value.updatedListing) updatedListing += 1;
        if (r.value.locationUpdated) locationUpdated += 1;
        if (r.value.scored) scored += 1;
        if (r.value.skippedAI) skippedAI += 1;
      } else {
        console.error(`[recompute] mlsId=${batch[i]!.mlsId}:`, r.reason);
      }
    }

    cursor = batch[batch.length - 1]?.mlsId;
    console.log(
      `[recompute] processed=${processed}/${total}, scored=${scored}, normalizedFieldUpdates=${updatedListing}, locationUpdated=${locationUpdated}, skippedAI=${skippedAI}`,
    );
  }

  console.log(`[recompute] refreshing materialized view…`);
  await db.$executeRawUnsafe(`REFRESH MATERIALIZED VIEW CONCURRENTLY "mv_listing_search"`);

  console.log(
    `[recompute] done — processed=${processed}, scored=${scored}, normalizedFieldUpdates=${updatedListing}, locationUpdated=${locationUpdated}, skippedAI=${skippedAI}`,
  );
}

main()
  .catch((err) => {
    console.error("[recompute] failed:", err);
    process.exit(1);
  })
  .finally(() => db.$disconnect());
