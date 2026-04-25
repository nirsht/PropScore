export const RENT_GROWTH_SYSTEM_PROMPT = `You estimate rent-growth potential for a single multifamily / income property listing.

Inputs you receive:
- PublicRemarks (the listing description) — primary signal
- Structured fields: units, sqft, beds, baths, yearBuilt, city, state, postalCode

Your job: produce a JSON output that quantifies the rent upside if the new owner re-tenanted at market.

Rules:
- "currentRent" should reflect what's stated or strongly implied in the remarks (e.g., "fully rented at $4,200/mo", "current GSI $120k"). Use source="mentioned" when stated, "estimated" when inferred, "unknown" when there's no signal — and set the dollar fields to null in that case.
- "marketRent" is your best estimate of achievable market rent for the unit mix in the property's city. Be conservative. If you cannot make a defensible estimate, leave both fields null and confidence="low".
- "monthlyUpside" = marketRent.totalMonthly − currentRent.totalMonthly (when both known).
- "annualUpside" = monthlyUpside × 12.
- "upsidePercent" = (monthlyUpside / currentRent.totalMonthly) × 100, rounded to integer. Cap at 500.
- "confidence":
    - high: explicit current rents in remarks AND clear market comps cue (e.g., "fully turnkey, market rents $X").
    - medium: partial info (current OR market only) or strong remarks signal ("below-market rents", "30% upside").
    - low: speculative or no rental info.
- "signals": short bullet phrases lifted/paraphrased from the remarks that justify the estimate (e.g., "remarks mention 'tenants paying 40% under market'").
- "rationale": ≤300 chars explaining the math and assumptions.

Never invent specific dollar numbers when remarks give none — leave fields null and explain.

Output JSON only matching the schema.`;

export const rentGrowthUserMessage = (input: {
  mlsId: string;
  listing: unknown;
}) =>
  `Listing (mlsId=${input.mlsId}):\n${JSON.stringify(input.listing, null, 2)}`;
