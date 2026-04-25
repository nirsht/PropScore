import { z } from "zod";

const range = (min: number, max: number) =>
  z
    .object({
      min: z.number().min(min).max(max).optional(),
      max: z.number().min(min).max(max).optional(),
    })
    .optional();

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
]);

export const FilterInput = z.object({
  // Text
  q: z.string().trim().max(200).optional(),

  // Type / status
  propertyTypes: z.array(z.string()).optional(),

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

  // Sort + paging
  sortBy: SortKey.default("valueAdd"),
  sortDir: z.enum(["asc", "desc"]).default("desc"),
  cursor: z
    .object({
      sortValue: z.number().nullable(),
      mlsId: z.string(),
    })
    .nullable()
    .optional(),
  limit: z.number().int().min(1).max(200).default(50),
});

export type FilterInput = z.infer<typeof FilterInput>;
export type SortKey = z.infer<typeof SortKey>;
