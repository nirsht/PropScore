export const fmtMoney = (n: number | null | undefined) =>
  n == null ? "—" : `$${Math.round(n).toLocaleString()}`;

export const fmtDate = (d: Date | string | null | undefined) =>
  d ? new Date(d).toLocaleDateString() : "—";

export const fmtNum = (n: number | null | undefined) =>
  n == null ? "—" : n.toLocaleString();

/**
 * Spell out a unit-mix entry the way an investor reads it — no MLS
 * shorthand. "4 x 3 Bedroom + 2 Bathroom" rather than "4× 3BR/2BA".
 */
export function unitTypeLabel(
  count: number,
  beds: number | null,
  baths: number | null,
): string {
  if (beds == null && baths == null) {
    return `${count} ${count === 1 ? "unit" : "units"}`;
  }
  const parts: string[] = [];
  if (beds === 0) {
    parts.push("Studio");
  } else if (beds != null) {
    parts.push(`${beds} Bedroom`);
  }
  if (baths != null) {
    parts.push(`${baths} Bathroom`);
  }
  return `${count} x ${parts.join(" + ")}`;
}

export function deriveRatio(
  num: number | null | undefined,
  den: number | null | undefined,
) {
  if (num == null || den == null || den === 0) return null;
  return num / den;
}
