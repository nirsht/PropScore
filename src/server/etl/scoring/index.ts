import type { NormalizedListing } from "../normalize";
import { densityScore } from "./density";
import { motivationScore } from "./motivation";
import { vacancyScore } from "./vacancy";
import { VALUE_ADD_WEIGHTS, weightedValueAdd } from "./valueAdd";

export type ComputedScore = {
  densityScore: number;
  vacancyScore: number;
  motivationScore: number;
  valueAddWeightedAvg: number;
  breakdown: Record<string, unknown>;
};

export function computeHeuristicScore(l: NormalizedListing): ComputedScore {
  const density = densityScore(l);
  const vacancy = vacancyScore(l);
  const motivation = motivationScore(l);
  const valueAddWeightedAvg = weightedValueAdd({
    densityScore: density,
    vacancyScore: vacancy,
    motivationScore: motivation,
  });

  return {
    densityScore: density,
    vacancyScore: vacancy,
    motivationScore: motivation,
    valueAddWeightedAvg,
    breakdown: {
      weights: VALUE_ADD_WEIGHTS,
      inputs: {
        daysOnMls: l.daysOnMls,
        units: l.units,
        propertyType: l.propertyType,
        beds: l.beds,
        stories: l.stories,
        occupancy: l.occupancy,
      },
      version: 1,
    },
  };
}
