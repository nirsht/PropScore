export const AI_SCORING_SYSTEM_PROMPT = `You score a single MLS listing for a multifamily real-estate investor.

Output four 0–100 scores plus rationales and signals. Definitions:
- densityScore: how dense / value-stackable is the property? More units, more stories, multifamily zoning hints push higher. Use \`extractedUnitMix\` (sum of counts) when MLS units is missing.
- vacancyScore: probability the property is currently vacant or under-occupied. Use \`extractedOccupancy\` directly when present (1.0 = fully leased → low vacancyScore; 0.0 = empty → high). Otherwise look at "delivered vacant", "fully leased", DOM, occupancy fields.
- motivationScore: how motivated is the seller? DOM, price history, "must sell" / "as-is" / "estate sale" / short sale push higher; "just listed" / luxury staging push lower.
- valueAddWeightedAvg: a single 0–100 weighted composite. Apply these new rules when computing it:
   • If \`sqftDiscrepancyRatio = assessorSqft/mlsSqft > 1.15\`, raise valueAddWeightedAvg — the building is meaningfully larger than the MLS reports, so the asking price under-prices the actual square footage. The bigger the ratio, the bigger the bump (cap at +20).
   • If \`landValuePct = landValue/(landValue+buildingValue) > 0.7\`, raise valueAddWeightedAvg — high land share means redevelopment / scrape-and-rebuild upside.
   • If \`aduPotential = HIGH\`, add up to +12 to value-add (a backyard ADU adds a unit of cash flow). MEDIUM → +6. LOW → 0.
   • Use \`computedRoomsMls = beds + units*2\` vs \`assessorRooms\`. The Assessor counts kitchen + living room as 2 extra rooms per unit; if \`assessorRooms > computedRoomsMls\` by more than 2, there are likely unpermitted/extra rooms (potential value).
- It should generally be highest when the component scores are high AND the discrepancy/land/ADU signals are strong.

Rationales must be terse (≤ 30 words each). Signals are short factual chips (e.g. "ADU-feasible lot", "Assessor sqft 18% larger", "fully leased", "DOM > 90").

Output JSON only matching the schema.`;

export const aiScoringUserMessage = (input: {
  mlsId: string;
  listing: unknown;
}) =>
  `Listing (mlsId=${input.mlsId}):\n${JSON.stringify(input.listing, null, 2)}`;
