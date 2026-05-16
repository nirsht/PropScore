import { Prisma } from "@prisma/client";
import { type SortKey } from "./schemas/filter";
import { type resolveWeights, VALUE_ADD_WEIGHTS } from "@/server/etl/scoring/valueAdd";
import type { ListingRow } from "./listing-types";

export const SORT_COLUMN: Record<SortKey, string> = {
  valueAdd: '"valueAddWeightedAvg"',
  price: '"price"',
  pricePerSqft: '"pricePerSqft"',
  pricePerUnit: '"pricePerUnit"',
  daysOnMls: '"daysOnMls"',
  postDate: '"postDate"',
  yearBuilt: '"yearBuilt"',
  density: '"densityScore"',
  vacancy: '"vacancyScore"',
  motivation: '"motivationScore"',
  valueAddAi: '"aiValueAddWeightedAvg"',
  densityAi: '"aiDensityScore"',
  vacancyAi: '"aiVacancyScore"',
  motivationAi: '"aiMotivationScore"',
};

/**
 * SQL mirror of `weightedValueAdd` from scoring/valueAdd.ts: weighted blend
 * of 5 component scores with null components dropped from the divisor.
 * Returns NULL when no components are present.
 *
 * Returned as a Prisma.Sql so callers can splice it into ORDER BY *and*
 * the SELECT list (so cursor pagination can read the same value back).
 */
export function weightedValueAddExpr(
  weights: ReturnType<typeof resolveWeights>,
  alias?: string,
): Prisma.Sql {
  const wV = weights.vacancy;
  const wL = weights.location;
  const wD = weights.density;
  const wA = weights.adu;
  const wM = weights.motivation;
  const expr = Prisma.sql`(
    COALESCE(${wV}::float * "vacancyScore", 0) +
    COALESCE(${wL}::float * "locationScore", 0) +
    COALESCE(${wD}::float * "densityScore", 0) +
    COALESCE(${wA}::float * "aduScore", 0) +
    COALESCE(${wM}::float * "motivationScore", 0)
  ) / NULLIF(
    (CASE WHEN "vacancyScore"    IS NOT NULL THEN ${wV}::float ELSE 0 END) +
    (CASE WHEN "locationScore"   IS NOT NULL THEN ${wL}::float ELSE 0 END) +
    (CASE WHEN "densityScore"    IS NOT NULL THEN ${wD}::float ELSE 0 END) +
    (CASE WHEN "aduScore"        IS NOT NULL THEN ${wA}::float ELSE 0 END) +
    (CASE WHEN "motivationScore" IS NOT NULL THEN ${wM}::float ELSE 0 END),
    0
  )`;
  return alias ? Prisma.sql`${expr} AS ${Prisma.raw(`"${alias}"`)}` : expr;
}

/** True when the supplied weights differ from VALUE_ADD_WEIGHTS by >1e-9. */
export function weightsDifferFromDefault(
  weights: ReturnType<typeof resolveWeights>,
): boolean {
  const keys = ["vacancy", "location", "density", "adu", "motivation"] as const;
  for (const k of keys) {
    if (Math.abs(weights[k] - VALUE_ADD_WEIGHTS[k]) > 1e-9) return true;
  }
  return false;
}

export function extractSortValue(row: ListingRow, key: SortKey): number | null {
  switch (key) {
    case "valueAdd":
      return row.valueAddWeightedAvg;
    case "price":
      return row.price;
    case "pricePerSqft":
      return row.pricePerSqft;
    case "pricePerUnit":
      return row.pricePerUnit;
    case "daysOnMls":
      return row.daysOnMls;
    case "postDate":
      return row.postDate.getTime();
    case "yearBuilt":
      return row.yearBuilt;
    case "density":
      return row.densityScore;
    case "vacancy":
      return row.vacancyScore;
    case "motivation":
      return row.motivationScore;
    case "valueAddAi":
      return row.aiValueAddWeightedAvg;
    case "densityAi":
      return row.aiDensityScore;
    case "vacancyAi":
      return row.aiVacancyScore;
    case "motivationAi":
      return row.aiMotivationScore;
  }
}
