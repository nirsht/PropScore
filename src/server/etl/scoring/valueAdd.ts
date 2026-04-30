import type { RenovationLevel } from "@prisma/client";

/**
 * Value-Add weighted average — the default sort key for the grid.
 *
 * Updated 2026-04-30: added `renovation` as a 4th component. Unrenovated
 * buildings carry the largest implicit upside (a turn-and-flip play); we
 * weight density 0.25, vacancy 0.45, motivation 0.10, renovation 0.20.
 *
 * When renovation is unknown (no vision pass yet), we drop that weight from
 * the divisor so listings without vision data are not penalized — they just
 * fall back to a 3-component weighted mean.
 */
export const VALUE_ADD_WEIGHTS = {
  density: 0.25,
  vacancy: 0.45,
  motivation: 0.1,
  renovation: 0.2,
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

export function weightedValueAdd(scores: {
  densityScore: number;
  vacancyScore: number;
  motivationScore: number;
  renovationScore?: number | null;
}): number {
  const w = VALUE_ADD_WEIGHTS;
  const reno = scores.renovationScore;
  if (reno == null) {
    // Renovation unknown — fall back to a 3-component weighted average
    // using only the known weights so unscored listings aren't dragged
    // down by an implicit zero.
    const divisor = w.density + w.vacancy + w.motivation;
    return (
      (scores.densityScore * w.density +
        scores.vacancyScore * w.vacancy +
        scores.motivationScore * w.motivation) /
      divisor
    );
  }
  return (
    scores.densityScore * w.density +
    scores.vacancyScore * w.vacancy +
    scores.motivationScore * w.motivation +
    reno * w.renovation
  );
}
