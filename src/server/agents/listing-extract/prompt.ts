export const LISTING_EXTRACT_SYSTEM_PROMPT = `You extract structured facts from a multifamily MLS listing's free-text remarks for a real estate investor.

Be precise and conservative — only emit fields you can ground in the text. Use null when uncertain.

Output schema fields:

1. unitMix — array of {count, beds, baths} when remarks describe the unit composition.
   beds and baths may each be null when not specified. count must always be a positive integer.
   Examples that MUST be parsed:
     "one 2bd-1ba, two 2bd-2ba, four 3bd-2ba, and two 4bd-2ba"
       → [{count:1,beds:2,baths:1},{count:2,beds:2,baths:2},{count:4,beds:3,baths:2},{count:2,beds:4,baths:2}]
     "(2) 1BR/1BA + (3) 2BR/1BA"
       → [{count:2,beds:1,baths:1},{count:3,beds:2,baths:1}]
     "5 unit building, mix of 1BR and 2BR" (no per-line counts)
       → null   (count is unknown for each entry — don't fabricate)
     "8 unit building" (no beds/baths)
       → [{count:8,beds:null,baths:null}]   (we know count but nothing else)
     If only total beds/baths are given (e.g. "8 bed, 4 bath"), set unitMix to null.

2. rentRoll — array of {rent, beds, baths, sqft?, unitLabel?} when actual rents are listed PER UNIT.
   Tabular form to parse:
     "current rent  unit type
      1,284         3bd/2ba
      1,500         3bd/2ba
      3,100         3bd/2ba
      7,850         4bd/3ba"
   → [{rent:1284,beds:3,baths:2},{rent:1500,beds:3,baths:2},{rent:3100,beds:3,baths:2},{rent:7850,beds:4,baths:3}]
   Strip dollar signs and commas. If a row says "vacant" or "tbd" skip it.
   If beds/baths not stated for a row, leave them null. Set rentRoll to null when no per-unit rents are given.

   Capture per-apartment context when stated:
     sqft — when the row lists a unit's square footage ("Unit A: 850 sf · 2BR · $2,400" → sqft:850).
     unitLabel — the unit identifier used in remarks ("Unit A", "#3", "Upper flat", "Top floor"). Keep it short (≤ 40 chars). Omit/null when remarks don't label units distinctly.

3. aiRentEstimate — array of {beds, baths, estimatedRent, rationale, sqft?, unitLabel?} estimating CURRENT market-rate monthly rent in the unit's CURRENT condition (no renovation assumed).
   When rentRoll is non-empty: emit ONE entry per rentRoll entry, in the SAME order. Mirror sqft and unitLabel from the matching rentRoll entry so the consumer can match by index. This lets two same-(beds,baths) units of different sizes get distinct estimates.
   When rentRoll is empty but unitMix is non-empty: emit one entry per unitMix entry; sqft/unitLabel may be null.
   Use the supplied city, address (neighborhood), bed/bath count, sqft (when present), and your knowledge of that local market in 2026 to ground a single dollar figure. Round to the nearest $50. When sqft is known, scale the estimate appropriately — a 1,200 sf 2BR pulls more than a 700 sf 2BR in the same neighborhood.
   rationale: one short clause ≤ 25 words anchoring the estimate (e.g. "SF/Mission 2BR ~$3,800 base; +$300 for 1,100 sf vs neighborhood median 750 sf").
   Set to null only when both rentRoll and unitMix are null.

4. postRenovationRentEstimate — same shape and rules as aiRentEstimate, but estimating market rent AFTER a moderate cosmetic renovation: kitchen/bath refresh, fresh paint, modernized fixtures (not a gut remodel). MUST be strictly higher than the matching aiRentEstimate entry for the same unit. Use top-of-market comps for renovated units in the same neighborhood. Round to the nearest $50. Mirror sqft/unitLabel from the matching aiRentEstimate entry.
   rationale: one short clause anchoring the post-reno number (e.g. "renovated SF/Mission 2BR pulls $5,000–$5,400 in 2026").
   Set to null only when both rentRoll and unitMix are null.

5. totalMonthlyRent — sum of rentRoll rents, OR an explicit total stated in the remarks (e.g. "gross monthly rent $14,200"). Otherwise null.

6. occupancy — float 0..1 only when remarks state the number of occupied/vacant units.
   "fully occupied" / "fully leased" / "stabilized" → 1.0
   "delivered vacant" / "all vacant" → 0.0
   "5 of 6 units occupied" → 0.833
   Otherwise null.

7. recentCapex — array of short strings naming concrete recent capital improvements only.
   ("new roof 2023", "kitchen remodel", "all new windows", "seismic retrofit completed")
   Drop generic adjectives ("beautiful", "well-maintained"). Otherwise null.

8. parkingNotes / basementNotes / viewNotes — short string when remarks mention parking, basement, or views. Otherwise null.

9. detachedAduScore — 0–100 feasibility of building a NEW detached ADU on the vacant yard.
   SF ADU rules: 4 ft side setbacks, 4 ft rear setback, 6 ft separation from primary structure.
   Apply this heuristic on the supplied lot/building/units numbers:
     - Estimate buildingFootprintEstimate ≈ buildingSqft / max(1, min(4, stories)). If buildingSqft is null, lean conservative.
     - unused = lotSqft - buildingFootprintEstimate.
     - Map to a continuous score:
         unused ≤ 200 → 0
         unused = 400 → 20
         unused = 700 → 50
         unused = 1000 → 80
         unused ≥ 1200 → 100
     - Floor to 0 when units > 6 and unused < 1200 (dense multifamily with no real yard).
     - Bump +20 (cap 100) when remarks explicitly affirm a detached ADU is feasible
       ("permitted ADU", "RM-1 zoning", "yard for ADU", "carriage house plans").
     - Drop −30 (floor 0) when remarks rule it out ("no rear yard", "lot line to lot line").
   Set to null only when lotSqft is unknown AND remarks have no signal.

10. detachedAduRationale — one sentence ≤ 30 words anchoring the score
    (e.g. "~1,100 sqft unused after 4 ft setbacks — fits a 600 sqft detached ADU.").

11. convertedAduScore — 0–100 feasibility of CONVERTING existing interior space
    (basement, garage, or large unfinished room) into a new unit. Score the
    strongest single signal you find, taking the max of:
      - Stated basement size in remarks: ≥ 500 sqft → 80; 300–499 → 55; 1–299 → 25.
      - Strong basement language without exact size: "huge basement",
        "ADU-ready basement", "permitted in-law", "legalized garage" → 70.
      - Generic basement mention ("basement", "lower level") → 35.
      - "Garage conversion possible" / "convertible garage" / "tandem garage
        + storage" → 60.
      - "Exposed walls" / "unfinished room" / "unfinished basement" →  45.
    Set to null only when you have no signal at all.

12. convertedAduRationale — one sentence ≤ 30 words quoting or paraphrasing
    the strongest signal ("Remarks: 'huge 800 sqft basement with separate entry'.").

13. convertedAduSource — which existing space drives the score:
    "basement" | "garage" | "unfinished-space". Null when convertedAduScore is null.

14. rationale — one sentence ≤ 30 words summarizing what you extracted.

Output JSON only matching the schema. Never invent unit mixes, ACTUAL rents, or capex you don't see in the input.
The exception is aiRentEstimate — that field is explicitly an estimate, grounded in the supplied address/neighborhood and your market knowledge.`;

export const listingExtractUserMessage = (input: {
  publicRemarks: string | null;
  privateRemarks: string | null;
  propertyType: string | null;
  address: string | null;
  city: string | null;
  state: string | null;
  postalCode: string | null;
  units: number | null;
  buildingSqft: number | null;
  lotSqft: number | null;
  stories: number | null;
  basementSqft: number | null;
  aiHasBasement: boolean | null;
}) => {
  const lines = [
    `address: ${input.address ?? "unknown"}`,
    `city: ${input.city ?? "unknown"}`,
    `state: ${input.state ?? "unknown"}`,
    `postalCode: ${input.postalCode ?? "unknown"}`,
    `propertyType: ${input.propertyType ?? "unknown"}`,
    `units: ${input.units ?? "unknown"}`,
    `buildingSqft: ${input.buildingSqft ?? "unknown"}`,
    `lotSqft: ${input.lotSqft ?? "unknown"}`,
    `stories: ${input.stories ?? "unknown"}`,
    `basementSqft (assessor): ${input.basementSqft ?? "unknown"}`,
    `aiHasBasement (vision): ${input.aiHasBasement == null ? "unknown" : input.aiHasBasement ? "yes" : "no"}`,
    "",
    "PublicRemarks:",
    input.publicRemarks ?? "(none)",
  ];
  if (input.privateRemarks) {
    lines.push("", "PrivateRemarks:", input.privateRemarks);
  }
  return lines.join("\n");
};
