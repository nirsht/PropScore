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

// Per-field evidence anchoring `stories` to the visual cue that produced it.
// There is no source text to quote for photo-derived fields, so we capture a
// concise observation instead. Surfaced in the Building details "Trail of
// evidence" panel.
export const StoriesEvidence = z.object({
  sourceType: z.enum(["exterior_photo", "interior_photo", "mixed"]),
  observation: z.string().min(1).max(160),
});

export const BuildingVisionOutput = z.object({
  bestPhotoUrl: z.string().url().nullable(),
  bestPhotoReason: z.string().nullable(),
  stories: z.number().int().nullable(),
  storiesEvidence: StoriesEvidence.nullable(),
  hasBasement: z.boolean().nullable(),
  hasPenthouse: z.boolean().nullable(),
  renovationLevel: RenovationLevelEnum.nullable(),
  renovationConfidence: z.number().min(0).max(1).nullable(),
  rationale: z.string(),
});

export type BuildingVisionInput = z.infer<typeof BuildingVisionInput>;
export type BuildingVisionOutput = z.infer<typeof BuildingVisionOutput>;
export type RenovationLevel = z.infer<typeof RenovationLevelEnum>;
export type StoriesEvidence = z.infer<typeof StoriesEvidence>;
