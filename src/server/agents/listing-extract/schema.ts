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
  // Optional per-apartment context — extracted when remarks list it
  // ("Unit A: 850 sf · 2BR/1BA · $2,400"). Lets the UI render distinct
  // rows for two same-bed/bath units of different sizes, and lets the
  // estimator scale by sqft.
  sqft: z.number().positive().nullable().optional(),
  unitLabel: z.string().max(40).nullable().optional(),
});

// AI-estimated market-rate rent for one unit. Emitted alongside `unitMix`
// (one entry per unit type) when the rent roll is empty, OR per
// rent-roll entry (matched by index OR unitLabel) when sizes differ.
// Consumer match priority: unitLabel > (beds, baths, sqft within 15%) > (beds, baths).
export const RentEstimateEntry = z.object({
  beds: z.number().int().min(0).nullable(),
  baths: z.number().min(0).nullable(),
  estimatedRent: z.number().positive(),
  rationale: z.string().max(160),
  // Optional — populated when the estimate is per-apartment (see RentRollEntry).
  sqft: z.number().positive().nullable().optional(),
  unitLabel: z.string().max(40).nullable().optional(),
  // "gpt" = GPT training-data prior; "comps" = grounded in SFAR closed leases
  // via the rent-comps agent. UI prefers "comps" when both exist.
  source: z.enum(["gpt", "comps"]).optional(),
});

// Source category for the converted-ADU read — drives the UI hint about
// which existing space to repurpose.
export const ConvertedAduSourceEnum = z.enum([
  "basement",
  "garage",
  "unfinished-space",
]);

// Per-field evidence anchoring `unitMix` to the verbatim text it came from.
// Surfaced in the Building details "Trail of evidence" panel so a reader can
// audit the AI's Units cell against the source.
export const UnitMixEvidence = z.object({
  sourceQuote: z.string().min(1).max(600),
  sourceField: z.enum(["publicRemarks", "privateRemarks"]),
});

export const ListingExtractOutput = z.object({
  unitMix: z.array(UnitMixEntry).nullable(),
  unitMixEvidence: UnitMixEvidence.nullable(),
  rentRoll: z.array(RentRollEntry).nullable(),
  aiRentEstimate: z.array(RentEstimateEntry).nullable(),
  // Same shape as aiRentEstimate, but assumes a moderate cosmetic renovation
  // (kitchens/baths refreshed, paint, modernized fixtures). Strictly higher
  // than aiRentEstimate for the same unit type.
  postRenovationRentEstimate: z.array(RentEstimateEntry).nullable(),
  totalMonthlyRent: z.number().nullable(),
  occupancy: z.number().min(0).max(1).nullable(),
  recentCapex: z.array(z.string()).nullable(),
  parkingNotes: z.string().nullable(),
  basementNotes: z.string().nullable(),
  viewNotes: z.string().nullable(),
  // Detached ADU — building a new unit on the vacant yard. 0–100 score with
  // a one-sentence rationale. Null score = no signal (e.g. lot size unknown).
  detachedAduScore: z.number().int().min(0).max(100).nullable(),
  detachedAduRationale: z.string(),
  // Converted ADU — repurposing existing space (basement / garage /
  // unfinished space) into a unit. 0–100 score; `convertedAduSource` names
  // the dominant signal; null source when no signal at all.
  convertedAduScore: z.number().int().min(0).max(100).nullable(),
  convertedAduRationale: z.string(),
  convertedAduSource: ConvertedAduSourceEnum.nullable(),
  rationale: z.string(),
});

export type ListingExtractInput = z.infer<typeof ListingExtractInput>;
export type ListingExtractOutput = z.infer<typeof ListingExtractOutput>;
export type UnitMixEntry = z.infer<typeof UnitMixEntry>;
export type RentRollEntry = z.infer<typeof RentRollEntry>;
export type RentEstimateEntry = z.infer<typeof RentEstimateEntry>;
export type ConvertedAduSource = z.infer<typeof ConvertedAduSourceEnum>;
export type UnitMixEvidence = z.infer<typeof UnitMixEvidence>;
