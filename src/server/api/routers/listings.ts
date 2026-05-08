import { z } from "zod";
import { TRPCError } from "@trpc/server";
import type { Prisma } from "@prisma/client";
import { protectedProcedure, router } from "../trpc";
import { FilterInput } from "../schemas/filter";
import { countListings, searchListings } from "../listings-search";
import {
  fetchListingMedia,
  fetchMember,
  fetchOffice,
  type BridgeMediaItem,
} from "@/server/etl/bridge-client";
import { normalizeListing } from "@/server/etl/normalize";
import { computeHeuristicScore } from "@/server/etl/scoring";

function round1(n: number) {
  return Math.round(n * 10) / 10;
}

export const listingsRouter = router({
  search: protectedProcedure.input(FilterInput).query(({ input }) => searchListings(input)),

  count: protectedProcedure.input(FilterInput).query(({ input }) => countListings(input)),

  getById: protectedProcedure
    .input(z.object({ mlsId: z.string() }))
    .query(async ({ ctx, input }) => {
      const listing = await ctx.db.listing.findUnique({
        where: { mlsId: input.mlsId },
        include: {
          score: true,
          enrichments: { orderBy: { createdAt: "desc" }, take: 5 },
          neighborhoodRel: {
            select: { name: true, crimeScore: true, crimeUpdatedAt: true },
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

      const h = normalized
        ? computeHeuristicScore(normalized, {
            // Assessor-first resolution to match the table.
            effectiveSqft: listing.assessorBuildingSqft ?? listing.sqft,
            effectiveUnits:
              listing.assessorUnits ?? listing.units ?? extractedUnitsTotal,
            effectiveStories:
              listing.assessorStories ?? listing.stories ?? listing.aiStories,
            renovationLevel: listing.renovationLevel,
            mlsSqft: listing.sqft,
            assessorSqft: listing.assessorBuildingSqft,
            assessorBuildingValue: listing.assessorBuildingValue,
            assessorLandValue: listing.assessorLandValue,
            extractedOccupancy: listing.extractedOccupancy,
            extractedUnitsTotal,
            aduPotential: listing.aduPotential as
              | "LOW"
              | "MEDIUM"
              | "HIGH"
              | null,
          })
        : null;
      const heuristicSnapshot = h
        ? {
            densityScore: round1(h.densityScore),
            vacancyScore: round1(h.vacancyScore),
            motivationScore: round1(h.motivationScore),
            valueAddWeightedAvg: round1(h.valueAddWeightedAvg),
          }
        : null;

      return { ...listing, heuristicSnapshot };
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

  /**
   * Look up phone/email for the listing agent, co-agent, and brokerage.
   *
   * sfar's `Property` resource doesn't expose contact fields; they live on
   * the separate `/Member` and `/Office` resources (see bridge-client). We
   * fan out to those on demand using the IDs already stored on the
   * listing's `raw`. Results are cached in-process by bridge-client.
   */
  getContacts: protectedProcedure
    .input(z.object({ mlsId: z.string() }))
    .query(async ({ ctx, input }) => {
      const listing = await ctx.db.listing.findUnique({
        where: { mlsId: input.mlsId },
        select: { mlsId: true, raw: true },
      });
      if (!listing) throw new TRPCError({ code: "NOT_FOUND" });
      const raw = (listing.raw ?? {}) as Record<string, unknown>;

      const str = (v: unknown) =>
        typeof v === "string" && v.trim() ? v.trim() : null;

      const agentMlsId = str(raw.ListAgentMlsId);
      const coAgentMlsId = str(raw.CoListAgentMlsId);
      const officeMlsId = str(raw.ListOfficeMlsId);

      const [agent, coAgent, office] = await Promise.all([
        agentMlsId ? fetchMember(agentMlsId) : Promise.resolve(null),
        coAgentMlsId ? fetchMember(coAgentMlsId) : Promise.resolve(null),
        officeMlsId ? fetchOffice(officeMlsId) : Promise.resolve(null),
      ]);

      // Pick the most-callable phone the MLS exposes per agent. SFAR's data
      // is sparse — `MemberDirectPhone` is often null, so we fall back through
      // the same hierarchy a human would dial.
      const pickAgentPhone = (m: typeof agent) =>
        str(m?.MemberDirectPhone) ??
        str(m?.MemberMobilePhone) ??
        str(m?.MemberPreferredPhone) ??
        str(m?.MemberOfficePhone) ??
        str(m?.MemberTollFreePhone) ??
        null;

      const shape = (m: typeof agent, fallbackName: string | null) =>
        m == null
          ? fallbackName
            ? { name: fallbackName, phone: null, email: null, website: null }
            : null
          : {
              name: str(m.MemberFullName) ?? fallbackName,
              phone: pickAgentPhone(m),
              email: str(m.MemberEmail),
              website: str(m.SocialMediaWebsiteUrlOrId),
            };

      return {
        agent: shape(agent, str(raw.ListAgentFullName)),
        coAgent: shape(coAgent, str(raw.CoListAgentFullName)),
        office: office
          ? {
              name: str(office.OfficeName) ?? str(raw.ListOfficeName),
              phone: str(office.OfficePhone),
              email: str(office.OfficeEmail),
              website: str(office.SocialMediaWebsiteUrlOrId),
            }
          : str(raw.ListOfficeName)
            ? {
                name: str(raw.ListOfficeName),
                phone: null,
                email: null,
                website: null,
              }
            : null,
      };
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
