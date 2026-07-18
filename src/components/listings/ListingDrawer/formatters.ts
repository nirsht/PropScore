import { bedsBathsLabel } from "./rentRollEstimators";

export const fmtMoney = (n: number | null | undefined) =>
  n == null ? "—" : `$${Math.round(n).toLocaleString()}`;

export const fmtDate = (d: Date | string | null | undefined) =>
  d ? new Date(d).toLocaleDateString() : "—";

export const fmtNum = (n: number | null | undefined) =>
  n == null ? "—" : n.toLocaleString();

/**
 * Label a unit-mix entry in standard real-estate notation: "4 × 2 BD/1 Bath".
 * Delegates to bedsBathsLabel() so the bed/bath format stays identical to the
 * individual rent-roll rows.
 */
export function unitTypeLabel(
  count: number,
  beds: number | null,
  baths: number | null,
): string {
  if (beds == null && baths == null) {
    return `${count} ${count === 1 ? "unit" : "units"}`;
  }
  return `${count} × ${bedsBathsLabel(beds, baths)}`;
}

export function deriveRatio(
  num: number | null | undefined,
  den: number | null | undefined,
) {
  if (num == null || den == null || den === 0) return null;
  return num / den;
}
