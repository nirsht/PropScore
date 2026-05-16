import { z } from "zod";

const range = (min: number, max: number) =>
  z
    .object({
      min: z.number().min(min).max(max).optional(),
      max: z.number().min(min).max(max).optional(),
    })
    .optional();

export const RenovationLevelSchema = z.enum([
  "DISTRESSED",
  "ORIGINAL",
  "UPDATED",
  "RENOVATED",
]);
export type RenovationLevelFilter = z.infer<typeof RenovationLevelSchema>;

export const SortKey = z.enum([
  "valueAdd",
  "price",
  "pricePerSqft",
  "pricePerUnit",
  "daysOnMls",
  "postDate",
  "yearBuilt",
  "density",
  "vacancy",
  "motivation",
  // AI-scored variants — sort by the columns populated by `runAIScoring`
  // (Score.ai*). Listings never AI-scored show up as nulls and sort to the
  // bottom under DESC.
  "valueAddAi",
  "densityAi",
  "vacancyAi",
  "motivationAi",
]);

export const FilterInput = z.object({
  // Text
  q: z.string().trim().max(200).optional(),

  // City — multi-select (e.g. ["San Francisco"]). Default in the UI is
  // ["San Francisco"]; the user can uncheck it to see all cities.
  city: z.array(z.string()).optional(),

  // Type / status
  propertyTypes: z.array(z.string()).optional(),

  // Building vision: renovation level (multi-select).
  renovationLevel: z.array(RenovationLevelSchema).optional(),

  // Numeric ranges
  price: range(0, 1_000_000_000),
  pricePerSqft: range(0, 100_000),
  pricePerUnit: range(0, 100_000_000),
  sqft: range(0, 10_000_000),
  units: range(0, 1_000),
  beds: range(0, 100),
  baths: range(0, 100),
  yearBuilt: range(1800, 2100),
  daysOnMls: range(0, 5_000),
  occupancy: range(0, 100),

  // Score thresholds
  densityScore: range(0, 100),
  vacancyScore: range(0, 100),
  motivationScore: range(0, 100),
  valueAddWeightedAvg: range(0, 100),

  // Risk & Compliance — filter+display only, not part of valueAdd ranking.
  codeViolationsOpenCount: range(0, 100),
  housingNetUnitChange5y: range(-50, 50),

  // Tri-state: undefined/null = all, true = only listings with MLS↔Assessor
  // size disagreement (>5% on any of sqft/lotSqft/units/stories),
  // false = only listings without disagreement.
  hasSizeDiscrepancy: z.boolean().nullable().optional(),

  // Tri-state for rent-control coverage: undefined/null = all, true = only
  // listings flagged as covered (multi-unit residential built before 1979),
  // false = only listings flagged as exempt.
  rentControlCovered: z.boolean().nullable().optional(),

  // Per-user favorites filter. When true, restricts to listings the current
  // user has starred (joined against StarredListing in the SQL builder).
  starredOnly: z.boolean().optional(),

  // Date ranges (ISO YYYY-MM-DD strings — coerced to Date in the SQL builder).
  // `min` and `max` are independent: either alone is a valid one-sided range.
  postDate: z
    .object({
      min: z.string().optional(),
      max: z.string().optional(),
    })
    .optional(),

  // Geo
  radius: z
    .object({
      lat: z.number().min(-90).max(90),
      lng: z.number().min(-180).max(180),
      meters: z.number().int().positive().max(200_000),
    })
    .optional(),
  polygon: z
    .object({
      points: z
        .array(z.object({ lat: z.number(), lng: z.number() }))
        .min(3)
        .max(500),
    })
    .optional(),

  // Per-request scoring weights. When provided AND sortBy === "valueAdd",
  // the server re-ranks listings by a weighted blend of the 5 component
  // scores (instead of using the precomputed `valueAddWeightedAvg`). The
  // 5 keys must each be a non-negative number; the server normalizes to
  // sum-to-1 (mirroring how null components drop out of the divisor in
  // weightedValueAdd). When omitted, the persisted value-add average and
  // its dedicated index are used (faster path).
  scoringWeights: z
    .object({
      vacancy: z.number().min(0).max(1).optional(),
      location: z.number().min(0).max(1).optional(),
      density: z.number().min(0).max(1).optional(),
      adu: z.number().min(0).max(1).optional(),
      motivation: z.number().min(0).max(1).optional(),
    })
    .optional(),

  // Sort + paging — optional in the schema (defaults applied at the SQL
  // boundary). Using `.default()` here corrupts z.infer in tRPC v11 and forces
  // every consumer to spread/cast around `T | undefined`.
  sortBy: SortKey.optional(),
  sortDir: z.enum(["asc", "desc"]).optional(),
  cursor: z
    .object({
      sortValue: z.number().nullable(),
      mlsId: z.string(),
    })
    .nullable()
    .optional(),
  limit: z.number().int().min(1).max(200).optional(),
});

export const FILTER_DEFAULTS = {
  sortBy: "valueAdd" as const,
  sortDir: "desc" as const,
  limit: 50,
};

export type FilterInput = z.infer<typeof FilterInput>;
export type SortKey = z.infer<typeof SortKey>;
