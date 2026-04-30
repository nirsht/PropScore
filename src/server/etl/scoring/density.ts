import type { NormalizedListing } from "../normalize";
import type { HeuristicContext } from "./index";

/**
 * Density score — 0..100. Heuristic proxy for "how dense is this property?".
 * Combines unit count, story count, and beds, with a multifamily-type bonus.
 *
 * Reads from the resolved `effective*` fields when supplied via `ctx`, so a
 * row whose Bridge MLS feed is missing units/stories still scores correctly
 * once the SF Assessor + AI-vision passes have run.
 */
export function densityScore(
  l: NormalizedListing,
  ctx: HeuristicContext = {},
): number {
  let s = 50;

  const isMulti = /multi|income|duplex|triplex|fourplex|apartment/i.test(l.propertyType);
  if (isMulti) s += 20;

  const units = ctx.effectiveUnits ?? l.units;
  if (units != null) {
    if (units >= 8) s += 20;
    else if (units >= 4) s += 12;
    else if (units >= 2) s += 6;
  }

  const stories = ctx.effectiveStories ?? l.stories;
  if (stories != null && stories >= 3) s += 5;
  if (l.beds != null && l.beds >= 6) s += 5;

  return clamp(s);
}

function clamp(n: number) {
  return Math.max(0, Math.min(100, n));
}
