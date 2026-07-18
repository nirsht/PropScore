import type { NormalizedListing } from "../normalize";
import { daysSincePost } from "./daysLive";
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
  // Default to a low (occupied-leaning) base. Vacancy materially raises a
  // multifamily asset's value — an empty building can be renovated/repositioned
  // and re-leased at market — so a listing agent stresses it when it exists
  // ("delivered vacant", "tenant-free"). Silence therefore means occupied: if
  // neither the remarks nor the photos flag vacancy, assume tenants are in
  // place and keep the score low. Explicit vacancy language (VACANT_RE, +45)
  // is what lifts a listing back into the vacant band.
  let s = 20;

  // Strong VACANT signal: clear current/at-close vacancy. Bare "vacant"
  // intentionally excluded — it matched past-tense / photo-context mentions
  // ("photos shown when units were vacant") and over-flagged occupied listings.
  const VACANT_RE =
    /\b(delivered vacant|will be (delivered )?vacant|all (units )?vacant|sold vacant|no tenants( in place)?|owner[- ]occupied|tenant[- ]free|vacant at (close|coe|cod))\b/;
  const OCCUPIED_RE =
    /\b(fully (rented|occupied|leased)|stabilized|currently (fully )?(occupied|rented|leased)|tenant[- ]occupied|all units (are )?(occupied|rented|leased))\b/;
  // Value-add / below-market language implies units are occupied at below-market
  // rents — a vacant unit would lease at market, so "upside" can only exist when
  // tenants are in place. Weighted lighter than OCCUPIED_RE since it's an inference.
  const VALUE_ADD_RE =
    /\b(rental upside|below[- ]market rents?|under[- ]market rents?|below market rents?|value[- ]add|upside in rents?|rent (growth )?upside|rent[- ]controlled tenants?)\b/;

  if (VACANT_RE.test(remarks)) s += 45;
  if (OCCUPIED_RE.test(remarks)) s -= 25;
  if (VALUE_ADD_RE.test(remarks)) s -= 15;

  const dom = daysSincePost(l);
  if (dom > 60) s += 5;
  if (dom > 120) s += 5;

  return clamp(s);
}

function clamp(n: number) {
  return Math.max(0, Math.min(100, n));
}
