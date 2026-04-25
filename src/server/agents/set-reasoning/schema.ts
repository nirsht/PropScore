import { z } from "zod";
import { FilterInput } from "@/server/api/schemas/filter";

export const SetReasoningInput = z.object({
  question: z.string().min(1).max(2000),
  filter: FilterInput.optional(),
});

export const SetReasoningOutput = z.object({
  answer: z.string(),
  highlightedMlsIds: z.array(z.string()).default([]),
  followUps: z.array(z.string()).default([]),
});

export type SetReasoningInput = z.infer<typeof SetReasoningInput>;
export type SetReasoningOutput = z.infer<typeof SetReasoningOutput>;
