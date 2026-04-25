/**
 * Value-Add weighted average — the default sort key for the grid.
 *
 * Weights live in one place so they can be tuned without code changes
 * threading through the codebase. Updated 2026-04-25 per user direction:
 * vacancy is the strongest signal, density second, motivation least.
 */
export const VALUE_ADD_WEIGHTS = {
  density: 0.3,
  vacancy: 0.6,
  motivation: 0.1,
} as const;

export function weightedValueAdd(scores: {
  densityScore: number;
  vacancyScore: number;
  motivationScore: number;
}): number {
  const w = VALUE_ADD_WEIGHTS;
  return (
    scores.densityScore * w.density +
    scores.vacancyScore * w.vacancy +
    scores.motivationScore * w.motivation
  );
}
