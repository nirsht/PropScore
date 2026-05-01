import type { NormalizedListing } from "../normalize";
import type { HeuristicContext } from "./index";

/**
 * Vacancy score — 0..100. Higher = more likely vacant / under-occupied.
 *
 * Direct occupancy is rarely populated in MLS feeds. Resolution order:
 *   1. AI-extracted occupancy from PublicRemarks (most reliable when present)
 *   2. The MLS-normalized `l.occupancy` field (rare)
 *   3. Heuristic from remarks language + DOM
 */
export function vacancyScore(
  l: NormalizedListing,
  ctx: HeuristicContext = {},
): number {
  const occ = ctx.extractedOccupancy ?? l.occupancy;
  if (occ != null) {
    return clamp(100 - occ * 100);
  }

  const remarks = String(l.raw.PublicRemarks ?? "").toLowerCase();
  let s = 40;

  if (/vacant|delivered vacant|no tenants|owner occupied|will be vacant/.test(remarks)) s += 30;
  if (/fully (rented|occupied)|fully leased|stabilized/.test(remarks)) s -= 25;
  if (/below market rents|under-market|value-add/.test(remarks)) s += 15;

  if (l.daysOnMls > 60) s += 5;
  if (l.daysOnMls > 120) s += 5;

  return clamp(s);
}

function clamp(n: number) {
  return Math.max(0, Math.min(100, n));
}
