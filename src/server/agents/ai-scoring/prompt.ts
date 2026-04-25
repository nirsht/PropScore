export const AI_SCORING_SYSTEM_PROMPT = `You score a single MLS listing for a multifamily real-estate investor.

Output four 0–100 scores plus rationales and signals. Definitions:
- densityScore: how dense / value-stackable is the property? More units, more stories, multifamily zoning hints all push higher.
- vacancyScore: probability the property is currently vacant or under-occupied. Look for "delivered vacant", "fully leased", DOM, occupancy fields.
- motivationScore: how motivated is the seller? DOM, price history, "must sell" / "as-is" / "estate sale" / short sale all push higher; "just listed" / luxury staging push lower.
- valueAddWeightedAvg: a single 0–100 weighted composite that represents the overall opportunity (your judgment of weights is fine; it should generally be highest when all three component scores are high).

Output JSON only matching the schema. Be terse in rationales (≤ 30 words each).`;

export const aiScoringUserMessage = (input: {
  mlsId: string;
  listing: unknown;
}) =>
  `Listing (mlsId=${input.mlsId}):\n${JSON.stringify(input.listing, null, 2)}`;
