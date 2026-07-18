import { z } from "zod";
import type { Prisma } from "@prisma/client";
import { TRPCError } from "@trpc/server";
import { protectedProcedure, router } from "../trpc";
import { computeHeuristicScore } from "@/server/etl/scoring";
import { normalizeListing } from "@/server/etl/normalize";
import { CALIB_RADIUS_M } from "@/server/etl/scoring/location";
import {
  calibrationInputsFor,
  listingMlsIdsWithinRadius,
  loadCalibrations,
  pointKeyFor,
  upsertCalibration,
} from "@/server/etl/scoring/calibration";
import { recomputeListingScore } from "@/server/etl/recomputeListing";
import type { db as dbClient } from "@/lib/db";

type Db = typeof dbClient;

/**
 * Re-score every listing within CALIB_RADIUS_M of a point after its calibration
 * changed, then refresh the search MV so the grid reflects the new scores. The
 * drawer reads live via listings.getById and updates immediately regardless.
 */
async function recomputeAround(db: Db, lat: number, lng: number): Promise<number> {
  const affectedIds = await listingMlsIdsWithinRadius(db, lat, lng, CALIB_RADIUS_M);
  if (affectedIds.length === 0) return 0;
  const calibrations = await loadCalibrations(db);
  const listings = await db.listing.findMany({
    where: { mlsId: { in: affectedIds } },
    include: { score: true, neighborhoodRel: true },
  });
  for (const l of listings) {
    await recomputeListingScore(db, l, calibrations);
  }
  await db.$executeRawUnsafe(
    `REFRESH MATERIALIZED VIEW CONCURRENTLY "mv_listing_search"`,
  );
  return listings.length;
}

/** Load a listing's coordinates + address, or throw a friendly tRPC error. */
async function listingPoint(db: Db, mlsId: string) {
  const listing = await db.listing.findUnique({
    where: { mlsId },
    select: { mlsId: true, lat: true, lng: true, address: true },
  });
  if (!listing) {
    throw new TRPCError({ code: "NOT_FOUND", message: "Listing not found." });
  }
  if (listing.lat == null || listing.lng == null) {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: "This listing has no coordinates, so it can't be calibrated.",
    });
  }
  return { ...listing, lat: listing.lat, lng: listing.lng };
}

export const scoringRouter = router({
  recomputeHeuristic: protectedProcedure
    .input(z.object({ mlsIds: z.array(z.string()).min(1).max(500) }))
    .mutation(async ({ ctx, input }) => {
      const listings = await ctx.db.listing.findMany({
        where: { mlsId: { in: input.mlsIds } },
        include: { neighborhoodRel: { select: { crimeScore: true } } },
      });
      let updated = 0;
      for (const l of listings) {
        const normalized = normalizeListing(l.raw as Record<string, unknown>);
        if (!normalized) continue;
        const score = computeHeuristicScore(normalized, {
          locationScore: l.locationScore,
          extractedTotalMonthlyRent: l.extractedTotalMonthlyRent,
          extractedMarketMonthlyRent: l.extractedMarketMonthlyRent,
          detachedAduScore: l.detachedAduScore,
          attachedAduScore: l.attachedAduScore,
          convertedAduScore: l.convertedAduScore,
          assessorConstructionType: l.assessorConstructionType,
          landUseCategory: l.landUseCategory,
          permitsOwnParcelAduCount: l.permitsOwnParcelAduCount,
          permitsBlockAduRecentCount: l.permitsBlockAduRecentCount,
          permitsRadiusAduRecentCount: l.permitsRadiusAduRecentCount,
          codeViolationsOpenCount: l.codeViolationsOpenCount,
          codeViolationsRecentCount: l.codeViolationsRecentCount,
          housingNetUnitChange5y: l.housingNetUnitChange5y,
          rentControlCovered: l.rentControlCovered,
        });
        await ctx.db.score.upsert({
          where: { listingMlsId: l.mlsId },
          create: {
            listingMlsId: l.mlsId,
            densityScore: score.densityScore,
            vacancyScore: score.vacancyScore,
            motivationScore: score.motivationScore,
            locationScore: score.locationScore,
            aduScore: score.aduScore,
            valueAddWeightedAvg: score.valueAddWeightedAvg,
            breakdown: score.breakdown as Prisma.InputJsonValue,
            computedBy: "HEURISTIC",
          },
          update: {
            densityScore: score.densityScore,
            vacancyScore: score.vacancyScore,
            motivationScore: score.motivationScore,
            locationScore: score.locationScore,
            aduScore: score.aduScore,
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

  /**
   * The current calibration state for a listing's location score: an exact
   * per-address override (if any) plus whether nearby calibrations are nudging
   * this address. Drives the badge/affordance in LocationRatingCard.
   */
  getLocationCalibration: protectedProcedure
    .input(z.object({ mlsId: z.string() }))
    .query(async ({ ctx, input }) => {
      const listing = await ctx.db.listing.findUnique({
        where: { mlsId: input.mlsId },
        select: { lat: true, lng: true },
      });
      if (!listing || listing.lat == null || listing.lng == null) {
        return { exact: null, nearbyCount: 0 };
      }
      const exactRow = await ctx.db.locationCalibration.findUnique({
        where: { pointKey: pointKeyFor(listing.lat, listing.lng) },
        select: { calibratedScore: true, note: true, updatedAt: true },
      });
      const { nearby } = calibrationInputsFor(
        listing.lat,
        listing.lng,
        await loadCalibrations(ctx.db),
      );
      // Exclude the exact override from the "nearby influence" count.
      const nearbyCount = exactRow ? nearby.length - 1 : nearby.length;
      return { exact: exactRow, nearbyCount: Math.max(0, nearbyCount) };
    }),

  /**
   * Pin a listing's location score to a user-provided value. Hard-overrides
   * that exact address and nudges nearby listings (distance-decaying) on their
   * next recompute — which we trigger immediately for everything in range.
   */
  setLocationCalibration: protectedProcedure
    .input(
      z.object({
        mlsId: z.string(),
        calibratedScore: z.number().min(0).max(100),
        note: z.string().max(500).optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const point = await listingPoint(ctx.db, input.mlsId);
      await upsertCalibration(ctx.db, {
        lat: point.lat,
        lng: point.lng,
        calibratedScore: input.calibratedScore,
        label: point.address,
        listingMlsId: point.mlsId,
        note: input.note ?? null,
        createdBy: ctx.user.id,
      });
      const affected = await recomputeAround(ctx.db, point.lat, point.lng);
      return { affected, calibratedScore: input.calibratedScore };
    }),

  /** Remove a listing's exact calibration and re-score the affected radius. */
  clearLocationCalibration: protectedProcedure
    .input(z.object({ mlsId: z.string() }))
    .mutation(async ({ ctx, input }) => {
      const point = await listingPoint(ctx.db, input.mlsId);
      await ctx.db.locationCalibration.deleteMany({
        where: { pointKey: pointKeyFor(point.lat, point.lng) },
      });
      const affected = await recomputeAround(ctx.db, point.lat, point.lng);
      return { affected };
    }),
});
