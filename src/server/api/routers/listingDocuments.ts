import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { protectedProcedure, router } from "../trpc";

export const listingDocumentsRouter = router({
  // Manual uploads for the Documents tab in the listing drawer. Returned
  // alongside (not merged with) email attachments — DocumentsSection handles
  // ordering and the divider between the two sources.
  forListing: protectedProcedure
    .input(z.object({ listingMlsId: z.string() }))
    .query(async ({ ctx, input }) => {
      const rows = await ctx.db.listingDocument.findMany({
        where: {
          userId: ctx.user.id,
          listingMlsId: input.listingMlsId,
        },
        select: {
          id: true,
          filename: true,
          mimeType: true,
          size: true,
          createdAt: true,
          parsedAt: true,
          parseError: true,
          parsedRentRoll: true,
        },
        orderBy: { createdAt: "desc" },
      });
      return rows;
    }),

  delete: protectedProcedure
    .input(z.object({ id: z.string() }))
    .mutation(async ({ ctx, input }) => {
      const doc = await ctx.db.listingDocument.findUnique({
        where: { id: input.id },
        select: { userId: true },
      });
      if (!doc || doc.userId !== ctx.user.id) {
        throw new TRPCError({ code: "NOT_FOUND" });
      }
      await ctx.db.listingDocument.delete({ where: { id: input.id } });
      return { deleted: true as const };
    }),
});
