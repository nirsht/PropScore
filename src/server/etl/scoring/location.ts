/**
 * Location Rating — combines Walk Score (30%) and a neighborhood-safety
 * percentile derived from DataSF crime incidents (70%) into a single
 * 0–100 score per listing. Pure functions, no I/O — fed by
 * scripts/refresh-crime.ts and scripts/refresh-walkscore.ts.
 */

export const LOCATION_WEIGHTS = {
  walk: 0.3,
  neighborhood: 0.7,
} as const;

/** Per-category weights for the weighted incident count. */
export const CRIME_CATEGORY_WEIGHTS = {
  violent: 3,
  property: 1,
  qol: 0.5,
} as const;

export type CrimeCategory = keyof typeof CRIME_CATEGORY_WEIGHTS;

/**
 * Combine walk score and neighborhood safety into a single 0–100. When one
 * input is null the other is returned untouched (i.e. the missing weight is
 * dropped from the divisor — see valueAdd.ts for the same pattern). When
 * both are null, returns null so the UI can render "unavailable" rather
 * than a misleading 0.
 */
export function locationScore(args: {
  walkScore: number | null | undefined;
  neighborhoodScore: number | null | undefined;
}): number | null {
  const { walkScore, neighborhoodScore } = args;
  const haveWalk = walkScore != null;
  const haveNbhd = neighborhoodScore != null;
  if (!haveWalk && !haveNbhd) return null;
  if (haveWalk && !haveNbhd) return clamp(walkScore!);
  if (!haveWalk && haveNbhd) return clamp(neighborhoodScore!);
  const w = LOCATION_WEIGHTS;
  return clamp(walkScore! * w.walk + neighborhoodScore! * w.neighborhood);
}

/**
 * Bucket a DataSF incident_category into our three coarse categories.
 * Returns null for buckets we deliberately exclude from scoring
 * (Non-Criminal, Recovered Vehicle, Lost Property, etc.).
 */
export function bucketIncidentCategory(category: string): CrimeCategory | null {
  const c = category.trim().toLowerCase();

  // Violent crimes against persons.
  if (
    c.includes("assault") ||
    c.includes("robbery") ||
    c.includes("homicide") ||
    c.includes("sex offense") ||
    c.includes("rape") ||
    c.includes("weapons") ||
    c.includes("human trafficking") ||
    c.includes("kidnapping")
  ) {
    return "violent";
  }

  // Property crimes.
  if (
    c.includes("burglary") ||
    c.includes("larceny") ||
    c.includes("motor vehicle theft") ||
    c.includes("arson") ||
    c.includes("stolen property") ||
    c === "robbery" // already covered, but defensive
  ) {
    return "property";
  }

  // Quality-of-life / neighborhood disorder.
  if (
    c.includes("drug offense") ||
    c.includes("drug violation") ||
    c.includes("disorderly") ||
    c.includes("vandalism") ||
    c.includes("malicious mischief")
  ) {
    return "qol";
  }

  return null;
}

/**
 * Percentile-rank neighborhoods by their weighted incident count, then
 * invert so that the *least* crime-prone neighborhood scores 100 and the
 * worst scores 0. Robust to missing per-capita data.
 *
 * Input: one row per (neighborhood, category) with raw incident counts.
 * Output: Map<neighborhood, { crimeScore, weightedIncidents }>.
 */
export function percentileRankCrimeScores(
  stats: ReadonlyArray<{ neighborhood: string; category: CrimeCategory; count: number }>,
): Map<string, { crimeScore: number; weightedIncidents: number }> {
  // Aggregate per neighborhood.
  const weighted = new Map<string, number>();
  for (const row of stats) {
    const w = CRIME_CATEGORY_WEIGHTS[row.category];
    weighted.set(row.neighborhood, (weighted.get(row.neighborhood) ?? 0) + row.count * w);
  }

  if (weighted.size === 0) return new Map();
  const entries = [...weighted.entries()];
  if (entries.length === 1) {
    // With a single neighborhood, percentile rank is undefined. Hand back a
    // neutral 50 so we don't fail the pipeline.
    const [name, w] = entries[0]!;
    return new Map([[name, { crimeScore: 50, weightedIncidents: w }]]);
  }

  // Sort ascending — low weighted-count = safer = high score.
  const sorted = entries.sort((a, b) => a[1] - b[1]);
  const n = sorted.length;
  const out = new Map<string, { crimeScore: number; weightedIncidents: number }>();
  for (let i = 0; i < n; i++) {
    const [name, w] = sorted[i]!;
    // Standard percentile rank: i / (n - 1) ∈ [0, 1]. Invert so safest=100.
    const rank = i / (n - 1);
    const crimeScore = (1 - rank) * 100;
    out.set(name, { crimeScore: round2(crimeScore), weightedIncidents: w });
  }
  return out;
}

function clamp(n: number): number {
  if (Number.isNaN(n)) return 0;
  return Math.max(0, Math.min(100, n));
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}
