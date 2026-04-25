import { z } from "zod";
import { adminProcedure, protectedProcedure, router } from "../trpc";
import { runSync } from "@/server/etl/pipeline";

export const etlRouter = router({
  runs: protectedProcedure
    .input(
      z
        .object({ limit: z.number().int().min(1).max(100).default(20) })
        .optional()
        .default({ limit: 20 }),
    )
    .query(async ({ ctx, input }) =>
      ctx.db.syncRun.findMany({
        orderBy: { startedAt: "desc" },
        take: input.limit,
      }),
    ),

  current: protectedProcedure.query(async ({ ctx }) =>
    ctx.db.syncRun.findFirst({
      where: { status: "RUNNING" },
      orderBy: { startedAt: "desc" },
    }),
  ),

  syncNow: adminProcedure
    .input(z.object({ maxRows: z.number().int().positive().optional() }).optional())
    .mutation(async ({ input }) => {
      // Fire-and-forget so the request returns immediately and the UI polls runs.
      void runSync({ maxRows: input?.maxRows }).catch(() => {
        // The pipeline already records the failure on the SyncRun row.
      });
      return { started: true };
    }),
});
