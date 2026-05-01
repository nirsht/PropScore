import type { RenovationLevel } from "@prisma/client";

/**
 * Value-Add weighted average — the default sort key for the grid.
 *
 * Updated 2026-05-01: added three new components driven by the new data
 * we capture (size discrepancy, land-heavy ratio, ADU potential). Weights
 * are computed dynamically — null components drop out of the divisor so
 * unscored listings are not penalized.
 */
export const VALUE_ADD_WEIGHTS = {
  density: 0.18,
  vacancy: 0.32,
  motivation: 0.10,
  renovation: 0.15,
  // New components (2026-05-01)
  sizeDiscrepancy: 0.10, // Assessor sees more building than MLS reports → upside
  landRatio: 0.08,        // Land-heavy → redevelopment play
  adu: 0.07,              // Backyard ADU adds a unit → cash-flow upside
} as const;

/**
 * Higher = more value-add upside available. RENOVATED is a near-zero floor
 * because there's nothing left to reposition; DISTRESSED is the ceiling.
 */
export const RENOVATION_UPSIDE: Record<RenovationLevel, number> = {
  DISTRESSED: 100,
  ORIGINAL: 75,
  UPDATED: 35,
  RENOVATED: 10,
};

export function renovationUpsideScore(level: RenovationLevel | null | undefined): number | null {
  if (level == null) return null;
  return RENOVATION_UPSIDE[level];
}

/**
 * Size-discrepancy upside. When the Assessor's measured building sqft exceeds
 * the MLS-listed sqft, the building is actually larger than priced — the seller
 * (or their agent) under-measured. Stronger gap = bigger opportunity.
 */
export function sizeDiscrepancyScore(
  mlsSqft: number | null | undefined,
  assessorSqft: number | null | undefined,
): number | null {
  if (mlsSqft == null || assessorSqft == null) return null;
  if (mlsSqft <= 0 || assessorSqft <= 0) return null;
  const ratio = assessorSqft / mlsSqft;
  if (ratio < 1.05) return 20;  // negligible
  if (ratio < 1.15) return 50;  // meaningful difference
  if (ratio < 1.30) return 80;  // major (likely lazy MLS measurement)
  return 95;                    // huge — strong opportunity
}

/**
 * Land-heavy ratio. When the Assessor's land value dominates the building
 * value, the parcel is a redevelopment / scrape-and-rebuild play.
 */
export function landRatioScore(
  landValue: number | null | undefined,
  buildingValue: number | null | undefined,
): number | null {
  if (landValue == null || buildingValue == null) return null;
  if (landValue <= 0 && buildingValue <= 0) return null;
  const total = landValue + buildingValue;
  if (total <= 0) return null;
  const landPct = landValue / total;
  if (landPct > 0.85) return 100; // dirt deal
  if (landPct > 0.70) return 75;
  if (landPct > 0.55) return 50;
  return 25;
}

/**
 * ADU potential as a value-add component. HIGH = backyard fits a permitted
 * detached ADU under SF setback rules, adding a 5th-class unit.
 */
export function aduPotentialScore(level: "LOW" | "MEDIUM" | "HIGH" | null | undefined): number | null {
  if (level == null) return null;
  return level === "HIGH" ? 100 : level === "MEDIUM" ? 55 : 15;
}

export function weightedValueAdd(scores: {
  densityScore: number;
  vacancyScore: number;
  motivationScore: number;
  renovationScore?: number | null;
  sizeDiscrepancyScore?: number | null;
  landRatioScore?: number | null;
  aduScore?: number | null;
}): number {
  const w = VALUE_ADD_WEIGHTS;
  const components: Array<{ value: number; weight: number }> = [
    { value: scores.densityScore, weight: w.density },
    { value: scores.vacancyScore, weight: w.vacancy },
    { value: scores.motivationScore, weight: w.motivation },
  ];
  if (scores.renovationScore != null) {
    components.push({ value: scores.renovationScore, weight: w.renovation });
  }
  if (scores.sizeDiscrepancyScore != null) {
    components.push({ value: scores.sizeDiscrepancyScore, weight: w.sizeDiscrepancy });
  }
  if (scores.landRatioScore != null) {
    components.push({ value: scores.landRatioScore, weight: w.landRatio });
  }
  if (scores.aduScore != null) {
    components.push({ value: scores.aduScore, weight: w.adu });
  }

  const totalWeight = components.reduce((sum, c) => sum + c.weight, 0);
  if (totalWeight <= 0) return 0;
  const weighted = components.reduce((sum, c) => sum + c.value * c.weight, 0);
  return weighted / totalWeight;
}
