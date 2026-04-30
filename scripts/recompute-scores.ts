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
import type { Prisma } from "@prisma/client";

const BATCH = 500;

async function main() {
  const total = await db.listing.count();
  console.log(`[recompute] total listings: ${total}`);

  let cursor: string | undefined;
  let processed = 0;
  let scored = 0;
  let skippedAI = 0;
  let updatedListing = 0;

  while (true) {
    const batch = await db.listing.findMany({
      take: BATCH,
      ...(cursor ? { skip: 1, cursor: { mlsId: cursor } } : {}),
      orderBy: { mlsId: "asc" },
      include: { score: true },
    });
    if (batch.length === 0) break;

    for (const l of batch) {
      processed += 1;
      const raw = l.raw as Record<string, unknown>;
      const norm = normalizeListing(raw);
      if (!norm) continue;

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
        updatedListing += 1;
      }

      if (l.score?.computedBy === "AI") {
        skippedAI += 1;
        continue;
      }

      const s = computeHeuristicScore(norm, {
        effectiveSqft: l.sqft ?? l.assessorBuildingSqft,
        effectiveUnits: l.units ?? l.assessorUnits,
        effectiveStories: l.stories ?? l.aiStories ?? l.assessorStories,
        renovationLevel: l.renovationLevel,
      });
      await db.score.upsert({
        where: { listingMlsId: l.mlsId },
        create: {
          listingMlsId: l.mlsId,
          densityScore: s.densityScore,
          vacancyScore: s.vacancyScore,
          motivationScore: s.motivationScore,
          valueAddWeightedAvg: s.valueAddWeightedAvg,
          breakdown: s.breakdown as Prisma.InputJsonValue,
          computedBy: "HEURISTIC",
        },
        update: {
          densityScore: s.densityScore,
          vacancyScore: s.vacancyScore,
          motivationScore: s.motivationScore,
          valueAddWeightedAvg: s.valueAddWeightedAvg,
          breakdown: s.breakdown as Prisma.InputJsonValue,
          computedBy: "HEURISTIC",
          computedAt: new Date(),
        },
      });
      scored += 1;
    }

    cursor = batch[batch.length - 1]?.mlsId;
    console.log(
      `[recompute] processed=${processed}/${total}, scored=${scored}, normalizedFieldUpdates=${updatedListing}, skippedAI=${skippedAI}`,
    );
  }

  console.log(`[recompute] refreshing materialized view…`);
  await db.$executeRawUnsafe(`REFRESH MATERIALIZED VIEW CONCURRENTLY "mv_listing_search"`);

  console.log(
    `[recompute] done — processed=${processed}, scored=${scored}, normalizedFieldUpdates=${updatedListing}, skippedAI=${skippedAI}`,
  );
}

main()
  .catch((err) => {
    console.error("[recompute] failed:", err);
    process.exit(1);
  })
  .finally(() => db.$disconnect());
