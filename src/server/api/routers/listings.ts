import { z } from "zod";
import { TRPCError } from "@trpc/server";
import type { Prisma } from "@prisma/client";
import { protectedProcedure, router } from "../trpc";
import { FilterInput } from "../schemas/filter";
import { countListings, searchListings } from "../listings-search";
import { fetchListingMedia, type BridgeMediaItem } from "@/server/etl/bridge-client";

export const listingsRouter = router({
  search: protectedProcedure.input(FilterInput).query(({ input }) => searchListings(input)),

  count: protectedProcedure.input(FilterInput).query(({ input }) => countListings(input)),

  getById: protectedProcedure
    .input(z.object({ mlsId: z.string() }))
    .query(async ({ ctx, input }) => {
      const listing = await ctx.db.listing.findUnique({
        where: { mlsId: input.mlsId },
        include: { score: true, enrichments: { orderBy: { createdAt: "desc" }, take: 5 } },
      });
      if (!listing) throw new TRPCError({ code: "NOT_FOUND" });
      return listing;
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
