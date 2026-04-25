import { z } from "zod";
import type { Prisma } from "@prisma/client";
import { protectedProcedure, router } from "../trpc";
import { computeHeuristicScore } from "@/server/etl/scoring";
import { normalizeListing } from "@/server/etl/normalize";

export const scoringRouter = router({
  recomputeHeuristic: protectedProcedure
    .input(z.object({ mlsIds: z.array(z.string()).min(1).max(500) }))
    .mutation(async ({ ctx, input }) => {
      const listings = await ctx.db.listing.findMany({ where: { mlsId: { in: input.mlsIds } } });
      let updated = 0;
      for (const l of listings) {
        const normalized = normalizeListing(l.raw as Record<string, unknown>);
        if (!normalized) continue;
        const score = computeHeuristicScore(normalized);
        await ctx.db.score.upsert({
          where: { listingMlsId: l.mlsId },
          create: {
            listingMlsId: l.mlsId,
            densityScore: score.densityScore,
            vacancyScore: score.vacancyScore,
            motivationScore: score.motivationScore,
            valueAddWeightedAvg: score.valueAddWeightedAvg,
            breakdown: score.breakdown as Prisma.InputJsonValue,
            computedBy: "HEURISTIC",
          },
          update: {
            densityScore: score.densityScore,
            vacancyScore: score.vacancyScore,
            motivationScore: score.motivationScore,
            valueAddWeightedAvg: score.valueAddWeightedAvg,
            breakdown: score.breakdown as Prisma.InputJsonValue,
            computedBy: "HEURISTIC",
            computedAt: new Date(),
          },
        });
        updated += 1;
      }
      return { updated };
    }),
});
