import type { NormalizedListing } from "../normalize";

/**
 * Motivation score — 0..100. How motivated does the seller look?
 * Built from DOM, repeated price drops (when available in raw), and remark
 * language. AI enrichment refines this when the user clicks "Enrich with AI".
 */
export function motivationScore(l: NormalizedListing): number {
  let s = 30;

  // Days on market — the strongest deterministic signal we have.
  if (l.daysOnMls > 30) s += 10;
  if (l.daysOnMls > 60) s += 15;
  if (l.daysOnMls > 120) s += 20;
  if (l.daysOnMls > 240) s += 10;

  // Price-drop signal if Bridge surfaces it
  const previousPrice = num(l.raw.PreviousListPrice);
  if (previousPrice != null && previousPrice > l.price) {
    const drop = (previousPrice - l.price) / previousPrice;
    s += Math.min(25, Math.round(drop * 100));
  }

  const remarks = String(l.raw.PublicRemarks ?? "").toLowerCase();
  if (/motivated|must sell|bring (all )?offers|priced to sell|estate sale|as[- ]is/.test(remarks)) {
    s += 15;
  }
  if (/short sale|foreclosure|reo|bank owned/.test(remarks)) s += 15;
  if (/just listed|new to market/.test(remarks)) s -= 10;

  return clamp(s);
}

function num(v: unknown): number | null {
  if (v == null || v === "") return null;
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? n : null;
}

function clamp(n: number) {
  return Math.max(0, Math.min(100, n));
}
