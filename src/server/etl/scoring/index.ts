import type { RenovationLevel } from "@prisma/client";
import type { NormalizedListing } from "../normalize";
import { densityScore } from "./density";
import { motivationScore } from "./motivation";
import { vacancyScore } from "./vacancy";
import {
  RENOVATION_UPSIDE,
  VALUE_ADD_WEIGHTS,
  renovationUpsideScore,
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
  /** Building sqft to use for density (Bridge MLS, falling back to Assessor). */
  effectiveSqft?: number | null;
  /** Resolved unit count (Bridge units, falling back to Assessor units). */
  effectiveUnits?: number | null;
  /** Resolved story count (Bridge → AI vision → Assessor). */
  effectiveStories?: number | null;
  /** Renovation level from the vision pass, if available. */
  renovationLevel?: RenovationLevel | null;
};

export function computeHeuristicScore(
  l: NormalizedListing,
  ctx: HeuristicContext = {},
): ComputedScore {
  const density = densityScore(l, ctx);
  const vacancy = vacancyScore(l);
  const motivation = motivationScore(l);
  const renovation = renovationUpsideScore(ctx.renovationLevel ?? null);
  const valueAddWeightedAvg = weightedValueAdd({
    densityScore: density,
    vacancyScore: vacancy,
    motivationScore: motivation,
    renovationScore: renovation,
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
        occupancy: l.occupancy,
        renovationLevel: ctx.renovationLevel ?? null,
      },
      version: 2,
    },
  };
}
