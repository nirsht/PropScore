import type { NormalizedListing } from "../normalize";

/**
 * Density score — 0..100. Heuristic proxy for "how dense is this property?".
 * Combines units-per-acre style signal (units / lot via sqft fallback), beds,
 * and whether it's an obvious multi-family. Used at ETL time; the geo-aware
 * version (count of comparables in radius) ships in v2 once we have enough
 * rows for spatial KNN to be meaningful.
 */
export function densityScore(l: NormalizedListing): number {
  let s = 50;

  const isMulti = /multi|income|duplex|triplex|fourplex|apartment/i.test(l.propertyType);
  if (isMulti) s += 20;

  if (l.units != null) {
    if (l.units >= 8) s += 20;
    else if (l.units >= 4) s += 12;
    else if (l.units >= 2) s += 6;
  }

  if (l.stories != null && l.stories >= 3) s += 5;
  if (l.beds != null && l.beds >= 6) s += 5;

  return clamp(s);
}

function clamp(n: number) {
  return Math.max(0, Math.min(100, n));
}
