import { z } from "zod";
import { defineTool } from "../base/tools";
import { runAIScoring } from "../ai-scoring/agent";

/**
 * trigger_ai_scoring — runs the ai-scoring agent for the listing and
 * returns the new scores + rationale. Side effect: persists Score +
 * AIEnrichment, which is what the listing drawer reads.
 *
 * Expensive (LLM call). The chat agent should only invoke this when the
 * user explicitly asks for an AI re-score, not on every "what's the score?"
 * question (the existing Score row should already be in the listing context).
 */
export const triggerAiScoringTool = defineTool({
  name: "trigger_ai_scoring",
  description:
    "Run the AI opportunity scorer for this listing and return the new density / vacancy / motivation / value-add scores with rationale. Only invoke when the user explicitly asks for an AI re-score — for normal questions about the existing score, read it from the listing context.",
  input: z.object({
    mlsId: z.string(),
  }),
  run: async ({ mlsId }) => {
    return runAIScoring(mlsId, null);
  },
});
