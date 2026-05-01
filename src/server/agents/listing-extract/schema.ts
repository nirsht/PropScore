import { z } from "zod";

export const ListingExtractInput = z.object({
  mlsId: z.string(),
});

export const UnitMixEntry = z.object({
  count: z.number().int().positive(),
  // beds/baths nullable: remarks like "5 unit building" don't always specify
  // per-unit bed/bath counts. The agent emits null rather than guessing.
  beds: z.number().int().min(0).nullable(),
  baths: z.number().min(0).nullable(),
});

export const RentRollEntry = z.object({
  rent: z.number().positive(),
  beds: z.number().int().min(0).nullable(),
  baths: z.number().min(0).nullable(),
});

export const AduPotentialEnum = z.enum(["LOW", "MEDIUM", "HIGH"]);

export const ListingExtractOutput = z.object({
  unitMix: z.array(UnitMixEntry).nullable(),
  rentRoll: z.array(RentRollEntry).nullable(),
  totalMonthlyRent: z.number().nullable(),
  occupancy: z.number().min(0).max(1).nullable(),
  recentCapex: z.array(z.string()).nullable(),
  parkingNotes: z.string().nullable(),
  basementNotes: z.string().nullable(),
  viewNotes: z.string().nullable(),
  aduPotential: AduPotentialEnum.nullable(),
  aduConfidence: z.number().min(0).max(1),
  aduRationale: z.string(),
  rationale: z.string(),
});

export type ListingExtractInput = z.infer<typeof ListingExtractInput>;
export type ListingExtractOutput = z.infer<typeof ListingExtractOutput>;
export type UnitMixEntry = z.infer<typeof UnitMixEntry>;
export type RentRollEntry = z.infer<typeof RentRollEntry>;
export type AduPotential = z.infer<typeof AduPotentialEnum>;
