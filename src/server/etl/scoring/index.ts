import type { RenovationLevel } from "@prisma/client";
import type { NormalizedListing } from "../normalize";
import { assessmentDeltaScore } from "./assessmentDelta";
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
  type AduFeasibilityCtx,
  type WeightOverrides,
} from "./valueAdd";
import { zoningUpsideScore } from "./zoningUpside";

export type ComputedScore = {
  densityScore: number;
  vacancyScore: number;
  motivationScore: number;
  locationScore: number | null;
  aduScore: number | null;
  assessmentDeltaScore: number | null;
  zoningUpsideScore: number | null;
  marketUpsideScore: number | null;
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
  /** Pre-computed assessor improvement + land total. Mirrors the
   *  `assessedValueTotal` generated column on Listing. */
  assessedValueTotal?: number | null;
  extractedOccupancy?: number | null;
  extractedUnitsTotal?: number | null;
  aduPotential?: "LOW" | "MEDIUM" | "HIGH" | null;
  /** 0–100 location rating (walk + safety). Null when unavailable. */
  locationScore?: number | null;
  /** SF Open Data feasibility signals — feed `aduPotentialScore`. */
  assessorConstructionType?: string | null;
  landUseCategory?: string | null;
  permitsOwnParcelAduCount?: number | null;
  permitsBlockAduRecentCount?: number | null;
  permitsRadiusAduRecentCount?: number | null;
  /** Per-neighborhood comp medians for assessment-delta scoring. */
  neighborhoodMedianAssessedPerSqft?: number | null;
  neighborhoodMedianAssessedPerUnit?: number | null;
  neighborhoodCompSampleSize?: number | null;
  /** Max units allowed under base zoning (no state-law overlays). */
  zoningMaxUnits?: number | null;
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
  const aduFeasibilityCtx: AduFeasibilityCtx = {
    assessorConstructionType: ctx.assessorConstructionType,
    landUseCategory: ctx.landUseCategory,
    permitsOwnParcelAduCount: ctx.permitsOwnParcelAduCount,
    permitsBlockAduRecentCount: ctx.permitsBlockAduRecentCount,
    permitsRadiusAduRecentCount: ctx.permitsRadiusAduRecentCount,
  };
  const aduResult = aduPotentialScore(ctx.aduPotential, aduFeasibilityCtx);
  const adu = aduResult.score;
  const location = ctx.locationScore ?? null;
  const assessmentDelta = assessmentDeltaScore(l, ctx);
  const zoningUpside = zoningUpsideScore(l, ctx);

  // Combined Market Upside: simple average of non-null sub-scores. Null
  // when both sub-scores are null. NOT folded into VALUE_ADD_WEIGHTS in v1.
  const upsideParts = [assessmentDelta, zoningUpside].filter(
    (x): x is number => x != null,
  );
  const marketUpside =
    upsideParts.length === 0
      ? null
      : upsideParts.reduce((s, v) => s + v, 0) / upsideParts.length;

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
    assessmentDeltaScore: assessmentDelta,
    zoningUpsideScore: zoningUpside,
    marketUpsideScore: marketUpside,
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
        assessedValueTotal: ctx.assessedValueTotal ?? null,
        aduPotential: ctx.aduPotential ?? null,
        locationScore: location,
        zoningMaxUnits: ctx.zoningMaxUnits ?? null,
        neighborhoodMedianAssessedPerSqft:
          ctx.neighborhoodMedianAssessedPerSqft ?? null,
        neighborhoodMedianAssessedPerUnit:
          ctx.neighborhoodMedianAssessedPerUnit ?? null,
        neighborhoodCompSampleSize: ctx.neighborhoodCompSampleSize ?? null,
      },
      components: {
        density,
        vacancy,
        motivation,
        location,
        adu,
        aduFeasibility: aduResult.breakdown,
        assessmentDelta,
        zoningUpside,
        marketUpside,
        // legacy components — still surfaced for transparency, no longer
        // weighted into the value-add average.
        renovation,
        sizeDiscrepancy: sizeDiff,
        landRatio,
      },
      version: 5,
    },
  };
}

// re-export for convenience (used by callers that build a custom score view).
export { locationScore };
