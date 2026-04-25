import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { protectedProcedure, router } from "../trpc";
import { FilterInput } from "../schemas/filter";

export const filtersRouter = router({
  list: protectedProcedure.query(async ({ ctx }) =>
    ctx.db.savedFilter.findMany({
      where: { userId: ctx.user.id },
      orderBy: { createdAt: "desc" },
    }),
  ),

  save: protectedProcedure
    .input(z.object({ name: z.string().min(1).max(80), payload: FilterInput }))
    .mutation(async ({ ctx, input }) =>
      ctx.db.savedFilter.create({
        data: {
          userId: ctx.user.id,
          name: input.name,
          payload: input.payload,
        },
      }),
    ),

  remove: protectedProcedure
    .input(z.object({ id: z.string() }))
    .mutation(async ({ ctx, input }) => {
      const filter = await ctx.db.savedFilter.findUnique({ where: { id: input.id } });
      if (!filter || filter.userId !== ctx.user.id) {
        throw new TRPCError({ code: "NOT_FOUND" });
      }
      await ctx.db.savedFilter.delete({ where: { id: input.id } });
      return { ok: true };
    }),
});
