/**
 * Confidence scoring for SFPIM (SF Assessor) candidate rows against a
 * parsed listing address.
 */

import { escapeRegex, zeroPad, type AddressParts } from "./address-parser";
import { num, type SfpimRow } from "./sfpim-types";

export const MIN_SCORE = 60;

/**
 * Build the list of zero-padded street numbers to look for. For range
 * parcels Bridge passes "1306-1308" — we want to match either endpoint in
 * the assessor's location string (which itself encodes ranges as
 * "1308 1306 GUERRERO").
 */
export function rangeNumbers(streetNumber: string): string[] {
  const parts = streetNumber.split("-");
  const out = new Set<string>();
  for (const p of parts) {
    const trimmed = p.trim();
    if (/^\d+$/.test(trimmed)) out.add(zeroPad(trimmed));
  }
  return [...out];
}

/**
 * Score a single assessor row against the listing's parsed components.
 *
 * Hard requirements (returns null otherwise):
 *   - Zero-padded street number bounded by space/edge in `property_location`
 *     (no substring leakage: "67 HAIGHT" must not match "167 HAIGHT" or "1067 HAIGHT").
 *   - Street name appears as a whole token immediately after the number
 *     (or after the range second-number), so "OAK" can't match "OAKDALE".
 *
 * Score (additive, max 100):
 *   60 base for passing both hard requirements
 *   +15 if the assessor suffix tail matches (ST/AV/WY/…)
 *   +15 if assessor building sqft is within 0.5x..2x of the listing sqft
 *   +10 if assessor unit count is within ±1 of the listing's
 */
export function scoreCandidate(
  row: SfpimRow,
  parts: AddressParts,
): { score: number; reasons: string[] } | null {
  const loc = (row.property_location ?? "").toUpperCase().replace(/\s+/g, " ").trim();
  if (!loc) return null;

  const numbers = rangeNumbers(parts.streetNumber);
  if (numbers.length === 0) return null;

  // Dataset encodes single parcels as "0067 HAIGHT" and range parcels as
  // "0070 0067 HAIGHT". The number must appear bounded; allow an optional
  // second 4-5 digit number between number and name for ranges.
  const numAlternation = numbers.map(escapeRegex).join("|");
  const escapedName = escapeRegex(parts.streetName);
  const namePattern = new RegExp(
    `(?:^| )(?:${numAlternation})(?: \\d{4,5})? ${escapedName}(?: |$)`,
  );
  if (!namePattern.test(loc)) return null;

  const reasons: string[] = ["num+name"];
  let score = 60;

  if (parts.streetSuffix) {
    // After the name we expect "<SUFFIX><alphanum-subparcel>", e.g.
    // "HAIGHT ST0000". After whitespace squash: "... HAIGHT ST0000".
    const suffixPattern = new RegExp(
      ` ${escapedName} ${escapeRegex(parts.streetSuffix)}[A-Z0-9]`,
    );
    if (suffixPattern.test(loc)) {
      score += 15;
      reasons.push("suffix");
    }
  }

  if (parts.listingSqft && parts.listingSqft > 0) {
    const bldg = num(row.property_area);
    if (bldg != null && bldg > 0) {
      const ratio = bldg / parts.listingSqft;
      if (ratio >= 0.5 && ratio <= 2.0) {
        score += 15;
        reasons.push("sqft-close");
      }
    }
  }

  if (parts.listingUnits && parts.listingUnits > 0) {
    const u = num(row.number_of_units);
    if (u != null && u > 0 && Math.abs(u - parts.listingUnits) <= 1) {
      score += 10;
      reasons.push("units");
    }
  }

  return { score, reasons };
}
