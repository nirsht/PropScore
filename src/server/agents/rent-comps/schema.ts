import { z } from "zod";

export const RentCompsInput = z.object({
  mlsId: z.string(),
  /** Override the default 1-mile / 24-month window. */
  radiusMiles: z.number().positive().max(5).optional(),
  monthsBack: z.number().int().positive().max(60).optional(),
});

export const RentComp = z.object({
  listingKey: z.string(),
  beds: z.number().int().min(0).nullable(),
  baths: z.number().min(0).nullable(),
  sqft: z.number().int().positive().nullable(),
  monthlyRent: z.number().positive(),
  closeDate: z.string().nullable(),
  lat: z.number().nullable(),
  lng: z.number().nullable(),
  distanceMiles: z.number().nonnegative().nullable(),
  pricePerSqft: z.number().nullable(),
});
export type RentComp = z.infer<typeof RentComp>;

/**
 * One bucketed comp set: all closed leases matching a given (beds, baths)
 * pair within the configured radius/recency. The estimator scales the
 * median $/sqft to the target unit's sqft.
 */
export const RentCompBucket = z.object({
  beds: z.number().int().min(0).nullable(),
  baths: z.number().min(0).nullable(),
  count: z.number().int().nonnegative(),
  medianRent: z.number().nullable(),
  medianPricePerSqft: z.number().nullable(),
  medianSqft: z.number().nullable(),
});
export type RentCompBucket = z.infer<typeof RentCompBucket>;

export const RentCompsOutput = z.object({
  /** Center of the search circle. Echoes the listing's lat/lng for traceability. */
  origin: z.object({ lat: z.number(), lng: z.number() }),
  radiusMiles: z.number(),
  monthsBack: z.number(),
  /** Total comps fetched across all bed/bath bands. */
  totalComps: z.number().int().nonnegative(),
  /** Per-(beds, baths) aggregates the UI uses to render estimates. */
  buckets: z.array(RentCompBucket),
  /** Raw comps (capped at 50) — surfaced in tooltips and trace. */
  comps: z.array(RentComp),
  /** Short ≤180-char human summary. */
  summary: z.string(),
});

export type RentCompsInput = z.infer<typeof RentCompsInput>;
export type RentCompsOutput = z.infer<typeof RentCompsOutput>;
