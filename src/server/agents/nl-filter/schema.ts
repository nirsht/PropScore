import { z } from "zod";
import { FilterInput } from "@/server/api/schemas/filter";

export const NLFilterInput = z.object({
  q: z.string().min(1).max(500),
  // Required (callers must pass [] when none) — `.default()` confuses
  // BaseAgent's input/output zod-type inference.
  knownPropertyTypes: z.array(z.string()),
});

export const NLFilterOutput = z.object({
  filter: FilterInput,
  rationale: z.string(),
});

export type NLFilterInput = z.infer<typeof NLFilterInput>;
export type NLFilterOutput = z.infer<typeof NLFilterOutput>;
