import type { NormalizedListing } from "../normalize";

/**
 * Vacancy score — 0..100. Higher = more likely vacant / under-occupied.
 * Direct occupancy is rarely populated in MLS feeds, so we fall back to
 * heuristics: explicit occupancy, language hints in remarks (handled later
 * by AI enrichment), and DOM as a soft signal.
 */
export function vacancyScore(l: NormalizedListing): number {
  if (l.occupancy != null) {
    return clamp(100 - l.occupancy * 100);
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
