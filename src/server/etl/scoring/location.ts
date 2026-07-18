/**
 * Location Rating — combines Walk Score (50%) and a neighborhood-safety
 * percentile derived from DataSF crime incidents (50%) into a single
 * 0–100 score per listing. Pure functions, no I/O — fed by
 * scripts/refresh-crime.ts and scripts/refresh-walkscore.ts.
 *
 * The base score can be adjusted by user calibrations (see blendCalibration):
 * an exact per-address override, or a distance-decaying nudge from nearby
 * calibrations — because safety varies block-by-block within a neighborhood.
 */

export const LOCATION_WEIGHTS = {
  walk: 0.5,
  neighborhood: 0.5,
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
 * Proximity-learning constants for user calibrations. A calibration is a
 * user-pinned "true" location score at a physical point (lat/lng). Its
 * influence decays with distance so a correction on one block barely moves a
 * listing three blocks away — the Mission swings 5→70 within a few hundred
 * metres, so the falloff must be steep.
 */
export const CALIB_RADIUS_M = 482; // ~0.3 mi — beyond this a calibration has no pull.
export const CALIB_SIGMA_M = 200; // Gaussian width — ~1 block gets a strong pull.
export const CALIB_MAX_TRUST = 0.6; // Cap: neighbours are nudged, never fully overridden.

export type NearbyCalibration = {
  /** Metres from the listing to the calibrated point. */
  distanceMeters: number;
  /** The user-pinned 0–100 score at that point. */
  calibratedScore: number;
};

/**
 * Fold user calibrations into a base location score.
 *
 * - `exact` (a calibration on this exact address) is a hard override — the
 *   user's number wins outright.
 * - Otherwise `nearby` calibrations form a distance-weighted prior (Gaussian
 *   falloff over CALIB_SIGMA_M). `confidence` — how far we lean toward that
 *   prior — grows with the summed weights but is capped at CALIB_MAX_TRUST, so
 *   a neighbour's correction only nudges this listing.
 * - No calibrations (or a null base) → the base score is returned unchanged.
 */
export function blendCalibration(args: {
  baseScore: number | null;
  exact?: { calibratedScore: number } | null;
  nearby?: ReadonlyArray<NearbyCalibration>;
}): number | null {
  const { baseScore, exact, nearby } = args;
  if (exact != null) return clamp(exact.calibratedScore);
  if (baseScore == null) return null;
  if (!nearby || nearby.length === 0) return clamp(baseScore);

  let weightSum = 0;
  let weightedScore = 0;
  for (const c of nearby) {
    if (c.distanceMeters > CALIB_RADIUS_M) continue;
    const w = Math.exp(-((c.distanceMeters / CALIB_SIGMA_M) ** 2));
    weightSum += w;
    weightedScore += w * c.calibratedScore;
  }
  if (weightSum === 0) return clamp(baseScore);

  const prior = weightedScore / weightSum;
  const confidence = Math.min(CALIB_MAX_TRUST, weightSum);
  return clamp(baseScore * (1 - confidence) + prior * confidence);
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
 * Score neighborhoods by their weighted incident count relative to the
 * citywide distribution: z-score each neighborhood against the mean/stddev
 * of all neighborhoods, then squash through a logistic curve so *least*
 * crime-prone trends toward 100 and worst trends toward 0 — without ever
 * pinning either extreme to the literal endpoint. A straight percentile
 * rank forces exactly one neighborhood to 0 and one to 100 regardless of
 * margin, which produced misleading scores for high-volume/high-foot-traffic
 * neighborhoods (e.g. Mission) that aren't uniquely dangerous per capita,
 * just busy. Robust to missing per-capita data.
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
    // With a single neighborhood, a z-score is undefined. Hand back a
    // neutral 50 so we don't fail the pipeline.
    const [name, w] = entries[0]!;
    return new Map([[name, { crimeScore: 50, weightedIncidents: w }]]);
  }

  const counts = entries.map(([, w]) => w);
  const mean = counts.reduce((a, b) => a + b, 0) / counts.length;
  const variance = counts.reduce((a, b) => a + (b - mean) ** 2, 0) / counts.length;
  const stddev = Math.sqrt(variance);

  const out = new Map<string, { crimeScore: number; weightedIncidents: number }>();
  for (const [name, w] of entries) {
    // z of safety: fewer incidents than the citywide mean = positive z.
    // stddev === 0 means every neighborhood tied — treat all as average.
    const z = stddev === 0 ? 0 : (mean - w) / stddev;
    const crimeScore = 100 / (1 + Math.exp(-z));
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
