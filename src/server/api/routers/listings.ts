import { z } from "zod";
import { TRPCError } from "@trpc/server";
import type { Prisma } from "@prisma/client";
import { protectedProcedure, router } from "../trpc";
import { FilterInput } from "../schemas/filter";
import { countListings, searchListings } from "../listings-search";
import { fetchListingMedia, type BridgeMediaItem } from "@/server/etl/bridge-client";
import { normalizeListing } from "@/server/etl/normalize";
import { computeHeuristicScore } from "@/server/etl/scoring";
import { daysSincePost } from "@/server/etl/scoring/daysLive";
import {
  fetchByBlockLot as fetchNovsByBlockLot,
  type NovLatest,
} from "@/server/etl/code-enforcement-client";
import {
  fetchByBlockLot as fetchComplaintsByBlockLot,
  type ComplaintLatest,
} from "@/server/etl/dbi-complaints-client";

function round1(n: number) {
  return Math.round(n * 10) / 10;
}

export const listingsRouter = router({
  search: protectedProcedure
    .input(FilterInput)
    .query(({ ctx, input }) => searchListings(input, ctx.user.id)),

  count: protectedProcedure
    .input(FilterInput)
    .query(({ ctx, input }) => countListings(input, ctx.user.id)),

  getById: protectedProcedure
    .input(z.object({ mlsId: z.string() }))
    .query(async ({ ctx, input }) => {
      const listing = await ctx.db.listing.findUnique({
        where: { mlsId: input.mlsId },
        include: {
          score: true,
          enrichments: { orderBy: { createdAt: "desc" }, take: 5 },
          neighborhoodRel: {
            select: {
              name: true,
              crimeScore: true,
              crimeUpdatedAt: true,
              medianAssessedPerSqft: true,
              medianAssessedPerUnit: true,
              medianSoldPricePerSqft: true,
              medianSoldPricePerUnit: true,
              compSampleSize: true,
              compsUpdatedAt: true,
            },
          },
          contact: {
            select: {
              source: true,
              agentName: true,
              agentPhone: true,
              agentEmail: true,
              agentWebsite: true,
              officeName: true,
              officePhone: true,
              officeEmail: true,
              officeWebsite: true,
              fetchedAt: true,
            },
          },
        },
      });
      if (!listing) throw new TRPCError({ code: "NOT_FOUND" });

      // Heuristic snapshot — recomputed from the listing's raw data on every
      // read. Used by the drawer to show AI ↔ heuristic deltas even after an
      // AI score has overwritten the persisted heuristic in `Score`.
      const normalized = normalizeListing(listing.raw as Record<string, unknown>);
      // Sum the AI-extracted unit-mix counts when MLS units missing.
      const extractedUnitsTotal = (() => {
        const um = listing.extractedUnitMix as
          | Array<{ count?: number }>
          | null
          | undefined;
        if (!Array.isArray(um) || um.length === 0) return null;
        const total = um.reduce((s, e) => s + (e.count ?? 0), 0);
        return total > 0 ? total : null;
      })();

      const assessedValueTotal =
        (listing.assessorBuildingValue ?? 0) + (listing.assessorLandValue ?? 0) ||
        null;

      const h = normalized
        ? computeHeuristicScore(normalized, {
            // Assessor-first resolution to match the table.
            effectiveSqft: listing.assessorBuildingSqft ?? listing.sqft,
            effectiveUnits:
              listing.assessorUnits ?? listing.units ?? extractedUnitsTotal,
            effectiveStories:
              listing.assessorStories ?? listing.stories ?? listing.aiStories,
            renovationLevel: listing.renovationLevel,
            renovationConfidence: listing.renovationConfidence,
            mlsSqft: listing.sqft,
            assessorSqft: listing.assessorBuildingSqft,
            assessorBuildingValue: listing.assessorBuildingValue,
            assessorLandValue: listing.assessorLandValue,
            assessedValueTotal,
            extractedOccupancy: listing.extractedOccupancy,
            extractedUnitsTotal,
            detachedAduScore: listing.detachedAduScore,
            attachedAduScore: listing.attachedAduScore,
            convertedAduScore: listing.convertedAduScore,
            locationScore: listing.locationScore,
            assessorConstructionType: listing.assessorConstructionType,
            landUseCategory: listing.landUseCategory,
            permitsOwnParcelAduCount: listing.permitsOwnParcelAduCount,
            permitsBlockAduRecentCount: listing.permitsBlockAduRecentCount,
            permitsRadiusAduRecentCount: listing.permitsRadiusAduRecentCount,
            codeViolationsOpenCount: listing.codeViolationsOpenCount,
            codeViolationsRecentCount: listing.codeViolationsRecentCount,
            housingNetUnitChange5y: listing.housingNetUnitChange5y,
            rentControlCovered: listing.rentControlCovered,
            neighborhoodMedianAssessedPerSqft:
              listing.neighborhoodRel?.medianAssessedPerSqft ?? null,
            neighborhoodMedianAssessedPerUnit:
              listing.neighborhoodRel?.medianAssessedPerUnit ?? null,
            neighborhoodCompSampleSize:
              listing.neighborhoodRel?.compSampleSize ?? null,
            zoningMaxUnits: listing.zoningMaxUnits,
          })
        : null;
      const heuristicSnapshot = h
        ? {
            densityScore: round1(h.densityScore),
            vacancyScore: round1(h.vacancyScore),
            motivationScore: round1(h.motivationScore),
            locationScore: h.locationScore != null ? round1(h.locationScore) : null,
            rehabScore: h.rehabScore != null ? round1(h.rehabScore) : null,
            aduScore: h.aduScore != null ? round1(h.aduScore) : null,
            valueAddWeightedAvg: round1(h.valueAddWeightedAvg),
            marketUpsideScore:
              h.marketUpsideScore != null ? round1(h.marketUpsideScore) : null,
            assessmentDeltaScore:
              h.assessmentDeltaScore != null
                ? round1(h.assessmentDeltaScore)
                : null,
            zoningUpsideScore:
              h.zoningUpsideScore != null ? round1(h.zoningUpsideScore) : null,
          }
        : null;

      // Override Bridge's forensic `daysOnMls` snapshot with the live
      // postDate-derived value the grid (via `mv_listing_search`) shows.
      return { ...listing, daysOnMls: daysSincePost(listing), heuristicSnapshot };
    }),

  getPhotos: protectedProcedure
    .input(
      z.object({
        mlsId: z.string(),
        /** Set true to bypass the cached `raw.Media` and re-probe Bridge. */
        refresh: z.boolean().optional(),
      }),
    )
    .query(async ({ ctx, input }) => {
      const listing = await ctx.db.listing.findUnique({
        where: { mlsId: input.mlsId },
        select: { mlsId: true, raw: true },
      });
      if (!listing) throw new TRPCError({ code: "NOT_FOUND" });

      const raw = listing.raw as Record<string, unknown> | null;
      const cached =
        !input.refresh && raw && Array.isArray((raw as { Media?: BridgeMediaItem[] }).Media)
          ? ((raw as { Media: BridgeMediaItem[] }).Media)
          : null;
      if (cached && cached.length) {
        return {
          items: cached,
          cached: true,
          via: "cache",
          attempts: [] as Awaited<ReturnType<typeof fetchListingMedia>>["attempts"],
        };
      }

      const result = await fetchListingMedia(input.mlsId);
      if (result.items.length && raw) {
        await ctx.db.listing.update({
          where: { mlsId: input.mlsId },
          data: { raw: { ...raw, Media: result.items } as Prisma.InputJsonValue },
        });
      }
      return {
        items: result.items,
        cached: false,
        via: result.via,
        attempts: result.attempts,
      };
    }),

  // Live drill-down for the Risk & compliance card's "View details" action —
  // reuses the nightly ETL's Socrata client to fetch every NOV on the parcel,
  // not just the single denormalized `codeViolationsLatest` breadcrumb.
  getCodeEnforcementDetail: protectedProcedure
    .input(z.object({ mlsId: z.string() }))
    .query(async ({ ctx, input }) => {
      const listing = await ctx.db.listing.findUnique({
        where: { mlsId: input.mlsId },
        select: { blockLot: true },
      });
      if (!listing) throw new TRPCError({ code: "NOT_FOUND" });
      if (!listing.blockLot) return { records: [] as NovLatest[], error: false };

      try {
        const summary = await fetchNovsByBlockLot(listing.blockLot);
        return { records: summary.records, error: false };
      } catch (err) {
        console.warn(`[listings:getCodeEnforcementDetail] fetch failed`, err);
        return { records: [] as NovLatest[], error: true };
      }
    }),

  // Live drill-down counterpart for DBI complaints — same shape as
  // `getCodeEnforcementDetail`, backed by the DBI complaints Socrata client.
  getComplaintsDetail: protectedProcedure
    .input(z.object({ mlsId: z.string() }))
    .query(async ({ ctx, input }) => {
      const listing = await ctx.db.listing.findUnique({
        where: { mlsId: input.mlsId },
        select: { blockLot: true },
      });
      if (!listing) throw new TRPCError({ code: "NOT_FOUND" });
      if (!listing.blockLot) return { records: [] as ComplaintLatest[], error: false };

      try {
        const summary = await fetchComplaintsByBlockLot(listing.blockLot);
        return { records: summary.records, error: false };
      } catch (err) {
        console.warn(`[listings:getComplaintsDetail] fetch failed`, err);
        return { records: [] as ComplaintLatest[], error: true };
      }
    }),

  facets: protectedProcedure.query(async ({ ctx }) => {
    const types = await ctx.db.listing.groupBy({
      by: ["propertyType"],
      _count: { _all: true },
      orderBy: { _count: { propertyType: "desc" } },
      take: 50,
    });
    return {
      propertyTypes: types.map((t) => ({ value: t.propertyType, count: t._count._all })),
    };
  }),
});
