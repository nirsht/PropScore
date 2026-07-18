import { z } from "zod";

export const ListingExtractInput = z.object({
  mlsId: z.string(),
});

// Residential vs commercial space. A mixed-use building (e.g. two flats over a
// ground-floor market) has both. `kind` is optional for backward-compat: rows
// extracted before this field existed have no value, and consumers MUST treat
// a missing/undefined `kind` as "residential" — only an explicit "commercial"
// flags a retail/office/market space.
export const UnitKind = z.enum(["residential", "commercial"]);

export const UnitMixEntry = z.object({
  count: z.number().int().positive(),
  // beds/baths nullable: remarks like "5 unit building" don't always specify
  // per-unit bed/bath counts. The agent emits null rather than guessing.
  // Commercial spaces have no beds/baths — leave both null and set kind.
  beds: z.number().int().min(0).nullable(),
  baths: z.number().min(0).nullable(),
  kind: UnitKind.optional(),
});

export const RentRollEntry = z.object({
  // null = vacant unit. Kept in the array so totals/UI know the building's
  // real unit count and so per-row market/proforma estimates still line up.
  rent: z.number().min(0).nullable(),
  beds: z.number().int().min(0).nullable(),
  baths: z.number().min(0).nullable(),
  // Optional per-apartment context — extracted when remarks list it
  // ("Unit A: 850 sf · 2BR/1BA · $2,400"). Lets the UI render distinct
  // rows for two same-bed/bath units of different sizes, and lets the
  // estimator scale by sqft.
  sqft: z.number().positive().nullable().optional(),
  unitLabel: z.string().max(40).nullable().optional(),
  // Verbatim move-in / lease-start text from the rent roll. Stored as a
  // free-form string so we keep whatever the source said ("12/1/1992",
  // "04/15/2025", "MTM", "Vacant"); the UI parses for display/age.
  // Drives buyout assessment in rent-controlled markets.
  moveInDate: z.string().max(40).nullable().optional(),
  // "commercial" flags a retail/office/market row so the UI can label it a
  // "commercial unit" and the rent estimator can skip it (no residential
  // comp applies). Absent/undefined = residential. See UnitKind.
  kind: UnitKind.optional(),
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
//
// The prompt asks for ≤600 chars, but the model occasionally overshoots on
// dense tabular rent rolls. The schema cap is generous (1500) so a long
// quote doesn't fail the whole extract; the UI still truncates for display.
export const UnitMixEvidence = z.object({
  sourceQuote: z.string().min(1).max(1500),
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
  // Rationales are nullable: when the score is null (no signal in remarks
  // and no assessor data), the model legitimately has nothing to say. The
  // empty-remarks heuristic still emits a string, but we accept null from
  // the LLM rather than failing the whole extract.
  detachedAduRationale: z.string().nullable(),
  // Attached ADU — a new addition sharing a wall with the primary residence
  // (a rear/side build-out, not a freestanding cottage and not an interior
  // conversion). Same 4 ft side/rear setbacks under CA state ADU law, but
  // no 6 ft separation buffer since the ADU IS attached to the primary.
  attachedAduScore: z.number().int().min(0).max(100).nullable(),
  attachedAduRationale: z.string().nullable(),
  // Converted ADU — repurposing existing space (basement / garage /
  // unfinished space) into a unit. 0–100 score; `convertedAduSource` names
  // the dominant signal; null source when no signal at all.
  convertedAduScore: z.number().int().min(0).max(100).nullable(),
  convertedAduRationale: z.string().nullable(),
  convertedAduSource: ConvertedAduSourceEnum.nullable(),
  rationale: z.string(),
});

export type ListingExtractInput = z.infer<typeof ListingExtractInput>;
export type ListingExtractOutput = z.infer<typeof ListingExtractOutput>;
export type UnitKind = z.infer<typeof UnitKind>;
export type UnitMixEntry = z.infer<typeof UnitMixEntry>;
export type RentRollEntry = z.infer<typeof RentRollEntry>;
export type RentEstimateEntry = z.infer<typeof RentEstimateEntry>;
export type ConvertedAduSource = z.infer<typeof ConvertedAduSourceEnum>;
export type UnitMixEvidence = z.infer<typeof UnitMixEvidence>;
