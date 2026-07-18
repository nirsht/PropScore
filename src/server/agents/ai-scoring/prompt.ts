export const AI_SCORING_SYSTEM_PROMPT = `You score a single MLS listing for a multifamily real-estate investor.

Output four 0–100 scores plus rationales and signals. Definitions:
- densityScore: how dense / value-stackable is the property? More units, more stories, multifamily zoning hints push higher. Use \`extractedUnitMix\` (sum of counts) when MLS units is missing.
- vacancyScore: probability the property is currently vacant or under-occupied. Use \`extractedOccupancy\` directly when present (1.0 = fully leased → low vacancyScore; 0.0 = empty → high). When \`extractedOccupancy\` is null, look for explicit current-state signals in remarks: "delivered vacant" / "vacant at COE" / "no tenants" → high; "fully leased" / "tenant occupied" / "currently fully occupied" → low. DEFAULT TO LOW (assume occupied) when there is NO vacancy signal at all: vacancy adds value, so an agent stresses it when it exists — its ABSENCE means tenants are in place, not "unknown." Occupied-looking photos (furniture, personal belongings) reinforce this. Treat value-add language ("rental upside", "below-market rents", "value-add", "X% upside in rents", "rent-controlled tenants") as an OCCUPIED signal — units must be occupied at below-market rents for there to be upside. Ignore backward-looking "vacant" mentions ("photos when vacant", "previously vacant"). Long DOM only pushes higher when no occupancy signal contradicts it.
- motivationScore: how motivated is the seller? DOM, price history, "must sell" / "as-is" / "estate sale" / short sale push higher; "just listed" / luxury staging push lower. Compute DOM live as (today − postDate); ignore \`daysOnMls\` when it is null or 0 (Bridge's MLS snapshot is unreliable and often stale).
- valueAddWeightedAvg: a single 0–100 composite. This is a WEIGHTED AVERAGE, not a free-form impression score.
   • DEFAULT (your anchor): you are given \`valueAddWeights\` (vacancy .30, location .20, density .15, rehab .15, adu .15, motivation .05), the current \`heuristicComponents\`, and \`baselineValueAdd\` (their weighted average). Start from \`baselineValueAdd\`, then substitute YOUR re-scored densityScore / vacancyScore / motivationScore in place of the heuristic ones — location, rehab and adu have no AI counterpart, so carry them through unchanged. The resulting weighted average is your default answer.
   • These weights are binding: a low vacancyScore (occupied) or weak locationScore MUST drag the composite down by exactly their weight. Never let an appealing narrative ("value-add", "X% rent upside", "trust sale") override the arithmetic — that upside is already priced into the component scores.
   • ADJUST only with a documented reason. When a specific signal materially changes value beyond what the components capture, nudge the anchor and NAME the signal in rationale.valueAdd. Keep adjustments proportional; deviating more than ~15 points from the recomputed anchor should be rare and always justified. Signals that can justify an UPWARD nudge:
      – \`sqftDiscrepancyRatio = assessorSqft/mlsSqft > 1.15\` → building larger than MLS reports, asking price under-prices actual SF (up to +20, scaled by ratio).
      – \`landValuePct = landValue/(landValue+buildingValue) > 0.7\` → high land share, redevelopment / scrape-and-rebuild upside.
      – Both \`extractedTotalMonthlyRent\` (in-place gross) and \`extractedMarketMonthlyRent\` (disclosed market/pro-forma gross) present → rentGap = (market − inPlace)/inPlace. Unlike a vague "X% upside" narrative, this is the listing's OWN quantified in-place→market spread: ~50%+ → up to +15, ~30% → ~+10, ~15% → ~+5; no nudge when the gap is ≤ 0 or either figure is missing.
      – Strong ADU reads (largest of \`detachedAduScore\`, \`attachedAduScore\`, \`convertedAduScore\`) → up to +12 for one extra unit of cash flow; don't double-count multiple ADU paths.
      – \`assessorRooms\` exceeds \`computedRoomsMls = beds + units*2\` by more than 2 → likely unpermitted/extra rooms.
   • State the anchor and any adjustment in rationale.valueAdd (e.g. "baseline 51 → 58: assessor SF 22% over MLS").

Rationales must be terse (≤ 30 words each). Signals are short factual chips (e.g. "Detached ADU 80%", "Attached ADU 70% (rear addition)", "Converted ADU 55% (basement)", "Assessor sqft 18% larger", "fully leased", "DOM > 90").

Output JSON only matching the schema.`;

export const aiScoringUserMessage = (input: {
  mlsId: string;
  listing: unknown;
}) =>
  `Listing (mlsId=${input.mlsId}):\n${JSON.stringify(input.listing, null, 2)}`;
