import { z } from "zod";

export const RentGrowthInput = z.object({
  mlsId: z.string(),
});

export const RentGrowthOutput = z.object({
  currentRent: z
    .object({
      perUnitMonthly: z.number().nullable(),
      totalMonthly: z.number().nullable(),
      source: z.enum(["mentioned", "estimated", "unknown"]),
    })
    .nullable(),
  marketRent: z
    .object({
      perUnitMonthly: z.number().nullable(),
      totalMonthly: z.number().nullable(),
      methodology: z.string().nullable(),
    })
    .nullable(),
  monthlyUpside: z.number().nullable(),
  annualUpside: z.number().nullable(),
  upsidePercent: z.number().nullable(),
  confidence: z.enum(["low", "medium", "high"]),
  rationale: z.string(),
  signals: z.array(z.string()),
});

export type RentGrowthInput = z.infer<typeof RentGrowthInput>;
export type RentGrowthOutput = z.infer<typeof RentGrowthOutput>;
