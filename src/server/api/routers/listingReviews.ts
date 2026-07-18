import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { DealStatus } from "@prisma/client";
import { protectedProcedure, router } from "../trpc";
import { enrichListingContact } from "@/server/etl/contact-enrichment";

const DealStatusSchema = z.nativeEnum(DealStatus);

/** Normalize a free-text input to `string | null` (trim, empty → null). */
function orNull(v: string | null | undefined): string | null {
  if (v == null) return null;
  const t = v.trim();
  return t.length ? t : null;
}

/**
 * The deal-workspace annotation layer: one shared review row per listing,
 * holding the pipeline status, review notes, and manual contact overrides.
 * A missing row means status NEW with no note/overrides, so writes upsert and
 * reads coalesce absence to NEW.
 */
export const listingReviewsRouter = router({
  /**
   * Map of every non-default review row, keyed by mlsId — powers the grid's
   * inline status dropdown and the status filter badges. Listings absent from
   * the map are NEW. Kept small: only rows that actually exist are returned.
   */
  list: protectedProcedure.query(async ({ ctx }) => {
    const rows = await ctx.db.listingReview.findMany({
      select: { listingMlsId: true, dealStatus: true },
    });
    const map: Record<string, DealStatus> = {};
    for (const r of rows) map[r.listingMlsId] = r.dealStatus;
    return map;
  }),

  /** Full review row for one listing (drawer). Null when untouched. */
  get: protectedProcedure
    .input(z.object({ mlsId: z.string() }))
    .query(async ({ ctx, input }) => {
      return ctx.db.listingReview.findUnique({
        where: { listingMlsId: input.mlsId },
      });
    }),

  setStatus: protectedProcedure
    .input(z.object({ mlsId: z.string(), status: DealStatusSchema }))
    .mutation(async ({ ctx, input }) => {
      return ctx.db.listingReview.upsert({
        where: { listingMlsId: input.mlsId },
        create: {
          listingMlsId: input.mlsId,
          dealStatus: input.status,
          updatedByUserId: ctx.user.id,
        },
        update: { dealStatus: input.status, updatedByUserId: ctx.user.id },
      });
    }),

  setNote: protectedProcedure
    .input(z.object({ mlsId: z.string(), note: z.string().max(10_000).nullish() }))
    .mutation(async ({ ctx, input }) => {
      const note = orNull(input.note);
      return ctx.db.listingReview.upsert({
        where: { listingMlsId: input.mlsId },
        create: {
          listingMlsId: input.mlsId,
          note,
          updatedByUserId: ctx.user.id,
        },
        update: { note, updatedByUserId: ctx.user.id },
      });
    }),

  /** Set/clear the manual contact corrections. Any field omitted is left as-is;
   *  pass an explicit null (or empty string) to clear a single field. */
  setContactOverride: protectedProcedure
    .input(
      z.object({
        mlsId: z.string(),
        agentName: z.string().max(200).nullish(),
        agentEmail: z.string().max(200).nullish(),
        agentPhone: z.string().max(60).nullish(),
        officeName: z.string().max(200).nullish(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const fields = {
        agentName: orNull(input.agentName),
        agentEmail: orNull(input.agentEmail),
        agentPhone: orNull(input.agentPhone),
        officeName: orNull(input.officeName),
      };
      return ctx.db.listingReview.upsert({
        where: { listingMlsId: input.mlsId },
        create: {
          listingMlsId: input.mlsId,
          ...fields,
          updatedByUserId: ctx.user.id,
        },
        update: { ...fields, updatedByUserId: ctx.user.id },
      });
    }),

  /**
   * Force a fresh contact re-pull from Bridge + the enrichment chain for one
   * listing (the drawer's "Re-pull from Bridge" button). Bypasses the 30-day
   * freshness window and re-reads the listing's current Bridge `raw` agent /
   * office fields, then re-runs the LLM/Apollo fallbacks for any missing
   * phone/email. Returns the refreshed ListingContact row.
   */
  repullContact: protectedProcedure
    .input(z.object({ mlsId: z.string() }))
    .mutation(async ({ ctx, input }) => {
      const listing = await ctx.db.listing.findUnique({
        where: { mlsId: input.mlsId },
        select: {
          mlsId: true,
          address: true,
          city: true,
          state: true,
          postalCode: true,
          raw: true,
        },
      });
      if (!listing) throw new TRPCError({ code: "NOT_FOUND" });

      const result = await enrichListingContact(listing, { force: true });
      if (result.status === "error") {
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: `Contact re-pull failed: ${result.error}`,
        });
      }

      const contact = await ctx.db.listingContact.findUnique({
        where: { listingMlsId: input.mlsId },
        select: {
          source: true,
          agentName: true,
          agentPhone: true,
          agentEmail: true,
          officeName: true,
          officePhone: true,
          officeEmail: true,
          fetchedAt: true,
        },
      });
      return { status: result.status, contact };
    }),
});
