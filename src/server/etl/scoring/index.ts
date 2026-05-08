import type { RenovationLevel } from "@prisma/client";
import type { NormalizedListing } from "../normalize";
import { densityScore } from "./density";
import { locationScore } from "./location";
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
  type WeightOverrides,
} from "./valueAdd";

export type ComputedScore = {
  densityScore: number;
  vacancyScore: number;
  motivationScore: number;
  locationScore: number | null;
  aduScore: number | null;
  valueAddWeightedAvg: number;
  breakdown: Record<string, unknown>;
};

export type HeuristicContext = {
  effectiveSqft?: number | null;
  effectiveUnits?: number | null;
  effectiveStories?: number | null;
  renovationLevel?: RenovationLevel | null;
  mlsSqft?: number | null;
  assessorSqft?: number | null;
  assessorBuildingValue?: number | null;
  assessorLandValue?: number | null;
  extractedOccupancy?: number | null;
  extractedUnitsTotal?: number | null;
  aduPotential?: "LOW" | "MEDIUM" | "HIGH" | null;
  /** 0–100 location rating (walk + safety). Null when unavailable. */
  locationScore?: number | null;
  /**
   * Optional per-call weight overrides. When omitted, the canonical
   * `VALUE_ADD_WEIGHTS` are used. Used by the listings pipeline to persist
   * the canonical weighted avg; user-customized rankings happen at query
   * time, not at score-write time.
   */
  weights?: WeightOverrides;
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
  const location = ctx.locationScore ?? null;

  const valueAddWeightedAvg = weightedValueAdd(
    {
      vacancyScore: vacancy,
      locationScore: location,
      densityScore: density,
      aduScore: adu,
      motivationScore: motivation,
    },
    ctx.weights,
  );

  return {
    densityScore: density,
    vacancyScore: vacancy,
    motivationScore: motivation,
    locationScore: location,
    aduScore: adu,
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
        locationScore: location,
      },
      components: {
        density,
        vacancy,
        motivation,
        location,
        adu,
        // legacy components — still surfaced for transparency, no longer
        // weighted into the value-add average.
        renovation,
        sizeDiscrepancy: sizeDiff,
        landRatio,
      },
      version: 4,
    },
  };
}

// re-export for convenience (used by callers that build a custom score view).
export { locationScore };
