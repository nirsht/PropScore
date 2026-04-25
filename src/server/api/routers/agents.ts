import { z } from "zod";
import { protectedProcedure, router } from "../trpc";
import { agents } from "@/server/agents/registry";
import { NLFilterInput } from "@/server/agents/nl-filter/schema";
import { SetReasoningInput } from "@/server/agents/set-reasoning/schema";

export const agentsRouter = router({
  nlFilter: protectedProcedure
    .input(NLFilterInput)
    .mutation(({ ctx, input }) =>
      agents.nlFilter.run({ input, userId: ctx.user.id }).then((r) => r.output),
    ),

  setReasoning: protectedProcedure
    .input(SetReasoningInput)
    .mutation(({ ctx, input }) =>
      agents.setReasoning.run({ input, userId: ctx.user.id }).then((r) => r.output),
    ),

  aiScore: protectedProcedure
    .input(z.object({ mlsId: z.string() }))
    .mutation(({ ctx, input }) => agents.aiScoring.run(input.mlsId, ctx.user.id)),

  rentGrowth: protectedProcedure
    .input(z.object({ mlsId: z.string() }))
    .mutation(({ ctx, input }) => agents.rentGrowth.run(input.mlsId, ctx.user.id)),

  /**
   * Latest cached rent-growth estimate for a listing, if any. Used by the
   * drawer to render the result without re-running the agent.
   */
  latestRentGrowth: protectedProcedure
    .input(z.object({ mlsId: z.string() }))
    .query(async ({ ctx, input }) => {
      const row = await ctx.db.aIEnrichment.findFirst({
        where: { listingMlsId: input.mlsId, agentName: "rent-growth" },
        orderBy: { createdAt: "desc" },
      });
      return row;
    }),

  recentTraces: protectedProcedure
    .input(
      z.object({
        agentName: z.string().optional(),
        limit: z.number().int().min(1).max(50).default(20),
      }),
    )
    .query(({ ctx, input }) =>
      ctx.db.agentTrace.findMany({
        where: input.agentName ? { agentName: input.agentName } : {},
        orderBy: { createdAt: "desc" },
        take: input.limit,
      }),
    ),
});
