import type { NormalizedListing } from "../normalize";
import type { HeuristicContext } from "./index";

/**
 * Assessment delta — how far the parcel's total assessed value sits below
 * the neighborhood's median. A wide gap is shorthand for "long-held parcel
 * + plausibly distressed", which is exactly the cohort we want to surface
 * as value-add targets.
 *
 * Prop 13 caveat: assessed values are mechanically anchored to the last
 * sale year, so a 1980s-held parcel will always look "below norm" purely
 * by virtue of not having transacted recently. The signal is therefore
 * "long-held + plausibly distressed", NOT pure deferred-maintenance
 * evidence. The UI cross-checks this against `renovationLevel` and DOM so
 * the user can disambiguate.
 *
 * Returns null when the comp sample is too thin (< 5 listings) or the
 * basis (sqft / units) is missing — null components drop out of the
 * weighted-average divisor in `weightedValueAdd`.
 */

const MIN_SAMPLE = 5;

export function assessmentDeltaScore(
  l: NormalizedListing,
  ctx: HeuristicContext = {},
): number | null {
  const sampleSize = ctx.neighborhoodCompSampleSize ?? null;
  if (sampleSize == null || sampleSize < MIN_SAMPLE) return null;

  const assessedTotal = ctx.assessedValueTotal ?? null;
  if (assessedTotal == null || assessedTotal <= 0) return null;

  // Per-sqft basis preferred when both are available (less sensitive to
  // unit-count quirks like in-law conversions).
  const sqft = ctx.assessorSqft ?? ctx.effectiveSqft ?? null;
  const medianPerSqft = ctx.neighborhoodMedianAssessedPerSqft ?? null;
  if (sqft != null && sqft > 0 && medianPerSqft != null && medianPerSqft > 0) {
    return mapDelta(assessedTotal, medianPerSqft * sqft);
  }

  const units = ctx.effectiveUnits ?? l.units ?? null;
  const medianPerUnit = ctx.neighborhoodMedianAssessedPerUnit ?? null;
  if (units != null && units > 0 && medianPerUnit != null && medianPerUnit > 0) {
    return mapDelta(assessedTotal, medianPerUnit * units);
  }

  return null;
}

function mapDelta(assessedTotal: number, expected: number): number {
  if (expected <= 0) return 20;
  const delta = (expected - assessedTotal) / expected;
  // delta > 0 means assessed is BELOW expected (the value-add signal).
  if (delta <= 0) return 20;
  if (delta < 0.25) return 50;
  if (delta < 0.5) return 75;
  return 95;
}
