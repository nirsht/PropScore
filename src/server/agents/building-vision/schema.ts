import { z } from "zod";

export const RenovationLevelEnum = z.enum([
  "DISTRESSED",
  "ORIGINAL",
  "UPDATED",
  "RENOVATED",
]);

export const BuildingVisionInput = z.object({
  mlsId: z.string(),
});

export const BuildingVisionOutput = z.object({
  bestPhotoUrl: z.string().url().nullable(),
  bestPhotoReason: z.string().nullable(),
  stories: z.number().int().nullable(),
  hasBasement: z.boolean().nullable(),
  hasPenthouse: z.boolean().nullable(),
  renovationLevel: RenovationLevelEnum.nullable(),
  renovationConfidence: z.number().min(0).max(1).nullable(),
  rationale: z.string(),
});

export type BuildingVisionInput = z.infer<typeof BuildingVisionInput>;
export type BuildingVisionOutput = z.infer<typeof BuildingVisionOutput>;
export type RenovationLevel = z.infer<typeof RenovationLevelEnum>;
