import type { RenovationLevel } from "@prisma/client";
import type { NormalizedListing } from "../normalize";
import { densityScore } from "./density";
import { motivationScore } from "./motivation";
import { vacancyScore } from "./vacancy";
import {
  RENOVATION_UPSIDE,
  VALUE_ADD_WEIGHTS,
  aduPotentialScore,
  landRatioScore,
  renovationUpsideScore,
  sizeDiscrepancyScore,
  weightedValueAdd,
} from "./valueAdd";

export type ComputedScore = {
  densityScore: number;
  vacancyScore: number;
  motivationScore: number;
  valueAddWeightedAvg: number;
  breakdown: Record<string, unknown>;
};

export type HeuristicContext = {
  /** Building sqft to use for density (Assessor first, falling back to MLS). */
  effectiveSqft?: number | null;
  /** Resolved unit count (Assessor first, then MLS, then extracted unit-mix sum). */
  effectiveUnits?: number | null;
  /** Resolved story count (Assessor → MLS → AI vision). */
  effectiveStories?: number | null;
  /** Renovation level from the vision pass, if available. */
  renovationLevel?: RenovationLevel | null;
  // ----- New 2026-05-01 signals -----
  /** Raw MLS-listed sqft for discrepancy scoring. */
  mlsSqft?: number | null;
  /** Raw Assessor sqft for discrepancy scoring. */
  assessorSqft?: number | null;
  /** Assessor improvement value. */
  assessorBuildingValue?: number | null;
  /** Assessor land value. */
  assessorLandValue?: number | null;
  /** AI-extracted occupancy [0..1]. Beats `l.occupancy` when present. */
  extractedOccupancy?: number | null;
  /** AI-extracted unit-mix sum (used when MLS units missing). */
  extractedUnitsTotal?: number | null;
  /** AI-extracted ADU potential. */
  aduPotential?: "LOW" | "MEDIUM" | "HIGH" | null;
};

export function computeHeuristicScore(
  l: NormalizedListing,
  ctx: HeuristicContext = {},
): ComputedScore {
  const density = densityScore(l, ctx);
  const vacancy = vacancyScore(l, ctx);
  const motivation = motivationScore(l);
  const renovation = renovationUpsideScore(ctx.renovationLevel ?? null);
  const sizeDiff = sizeDiscrepancyScore(ctx.mlsSqft ?? l.sqft, ctx.assessorSqft);
  const landRatio = landRatioScore(ctx.assessorLandValue, ctx.assessorBuildingValue);
  const adu = aduPotentialScore(ctx.aduPotential);

  const valueAddWeightedAvg = weightedValueAdd({
    densityScore: density,
    vacancyScore: vacancy,
    motivationScore: motivation,
    renovationScore: renovation,
    sizeDiscrepancyScore: sizeDiff,
    landRatioScore: landRatio,
    aduScore: adu,
  });

  return {
    densityScore: density,
    vacancyScore: vacancy,
    motivationScore: motivation,
    valueAddWeightedAvg,
    breakdown: {
      weights: VALUE_ADD_WEIGHTS,
      renovationUpside: RENOVATION_UPSIDE,
      inputs: {
        daysOnMls: l.daysOnMls,
        units: ctx.effectiveUnits ?? l.units,
        propertyType: l.propertyType,
        beds: l.beds,
        stories: ctx.effectiveStories ?? l.stories,
        sqft: ctx.effectiveSqft ?? l.sqft,
        mlsSqft: ctx.mlsSqft ?? l.sqft,
        assessorSqft: ctx.assessorSqft,
        occupancy: ctx.extractedOccupancy ?? l.occupancy,
        renovationLevel: ctx.renovationLevel ?? null,
        landValue: ctx.assessorLandValue,
        buildingValue: ctx.assessorBuildingValue,
        aduPotential: ctx.aduPotential ?? null,
      },
      components: {
        density,
        vacancy,
        motivation,
        renovation,
        sizeDiscrepancy: sizeDiff,
        landRatio,
        adu,
      },
      version: 3,
    },
  };
}
