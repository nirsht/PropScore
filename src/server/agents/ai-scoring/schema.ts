import { z } from "zod";

export const AIScoringInput = z.object({
  mlsId: z.string(),
});

export const AIScoringOutput = z.object({
  densityScore: z.number().min(0).max(100),
  vacancyScore: z.number().min(0).max(100),
  motivationScore: z.number().min(0).max(100),
  valueAddWeightedAvg: z.number().min(0).max(100),
  rationale: z.object({
    density: z.string(),
    vacancy: z.string(),
    motivation: z.string(),
    valueAdd: z.string(),
  }),
  signals: z.array(z.string()),
});

export type AIScoringInput = z.infer<typeof AIScoringInput>;
export type AIScoringOutput = z.infer<typeof AIScoringOutput>;
