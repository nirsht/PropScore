import type { HeuristicContext } from "./index";

/**
 * Rental income upside — the gap between a building's current in-place gross
 * rent and its disclosed market / pro-forma gross rent. Both figures come
 * from the listing-extract agent (Listing.extractedTotalMonthlyRent and
 * Listing.extractedMarketMonthlyRent), which normalizes the remarks' income
 * story to monthly. A "$265K/yr in-place → $490K/yr market" listing carries
 * ~85% rent upside that nothing else in the scoring scheme captures.
 *
 * This is the listing agent's OWN stated spread — a stronger signal than a
 * per-unit AI estimate — so we only score it when the remarks disclose both
 * sides. Returns null when either figure is missing or the market rent
 * doesn't exceed the in-place rent (no positive upside to score), mirroring
 * the RentRollSection UI which suppresses the upside chip in that case.
 *
 * Banding matches the sibling upside sub-scores (assessmentDelta / zoning):
 * discrete bands on the gap fraction, topping out at 95 for the exceptional
 * 50%+ spreads typical of deep value-add repositioning plays.
 */
export function rentalUpsideScore(ctx: HeuristicContext = {}): number | null {
  const inPlace = ctx.extractedTotalMonthlyRent ?? null;
  const market = ctx.extractedMarketMonthlyRent ?? null;
  if (inPlace == null || inPlace <= 0 || market == null) return null;
  if (market <= inPlace) return null;

  const gap = (market - inPlace) / inPlace;
  if (gap >= 0.5) return 95;
  if (gap >= 0.3) return 80;
  if (gap >= 0.15) return 60;
  if (gap >= 0.05) return 40;
  return 25;
}
