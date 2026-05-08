import type { NormalizedListing } from "../normalize";
import type { HeuristicContext } from "./index";

/**
 * Zoning under-utilization — current units / max-allowed units under base
 * zoning. A 3-unit building on an RM-2 lot of 4,800 sqft can legally hold
 * ~8 units; that's repositionable upside that nothing else in the scoring
 * scheme captures.
 *
 * Base zoning ONLY. State-law overlays (SB-9, AB-2011, density bonuses)
 * are not applied in v1, so we underestimate upside on commercial corridor
 * lots. The UI surfaces this caveat.
 *
 * Returns null when either current units or max units is unknown — both
 * are required for a meaningful slack ratio. Legal-nonconforming buildings
 * (current > max) clamp to a low score rather than going negative.
 */
export function zoningUpsideScore(
  l: NormalizedListing,
  ctx: HeuristicContext = {},
): number | null {
  const max = ctx.zoningMaxUnits ?? null;
  if (max == null || max <= 0) return null;

  const current = ctx.effectiveUnits ?? l.units ?? ctx.extractedUnitsTotal ?? null;
  if (current == null || current <= 0) return null;

  if (current >= max) return 10; // legal-nonconforming or fully built out
  const slack = (max - current) / max;
  if (slack < 0.25) return 35;
  if (slack < 0.5) return 65;
  if (slack < 0.75) return 85;
  return 100;
}
