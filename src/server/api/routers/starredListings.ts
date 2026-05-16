import { z } from "zod";
import { protectedProcedure, router } from "../trpc";

export const starredListingsRouter = router({
  list: protectedProcedure.query(async ({ ctx }) => {
    const rows = await ctx.db.starredListing.findMany({
      where: { userId: ctx.user.id },
      select: { listingMlsId: true },
      orderBy: { createdAt: "desc" },
    });
    return rows.map((r) => r.listingMlsId);
  }),

  toggle: protectedProcedure
    .input(z.object({ mlsId: z.string() }))
    .mutation(async ({ ctx, input }) => {
      const where = {
        userId_listingMlsId: {
          userId: ctx.user.id,
          listingMlsId: input.mlsId,
        },
      };
      const existing = await ctx.db.starredListing.findUnique({ where });
      if (existing) {
        await ctx.db.starredListing.delete({ where });
        return { starred: false };
      }
      await ctx.db.starredListing.create({
        data: { userId: ctx.user.id, listingMlsId: input.mlsId },
      });
      return { starred: true };
    }),
});
