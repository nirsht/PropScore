import { describe, expect, it } from "vitest";
import { enrichRentRoll } from "./enrichRentRoll";
import type {
  RentCompsOutputUI,
  RentEstimateEntryUI,
  RentRollEntryUI,
  UnitMixEntryUI,
} from "./types";

const baseArgs = {
  unitMix: null,
  extractedTotalMonthlyRent: null,
};

describe("enrichRentRoll post-remodel rebase", () => {
  it("lifts postReno above comps using the LLM uplift ratio", () => {
    const rentRoll: RentRollEntryUI[] = [
      { rent: 2000, beds: 2, baths: 1, sqft: 900, unitLabel: null },
    ];
    // LLM: aiRent 3400, postReno 4200 → 23.5% uplift ratio
    const aiRentEstimate: RentEstimateEntryUI[] = [
      {
        beds: 2,
        baths: 1,
        estimatedRent: 3400,
        rationale: "LLM current",
        sqft: 900,
      },
    ];
    const postRenoEstimate: RentEstimateEntryUI[] = [
      {
        beds: 2,
        baths: 1,
        estimatedRent: 4200,
        rationale: "LLM post-reno",
        sqft: 900,
      },
    ];
    // Comps median pulls market to 4500 — above raw postReno of 4200
    const compsOutput: RentCompsOutputUI = {
      totalComps: 8,
      radiusMiles: 1,
      monthsBack: 24,
      summary: "8 SFAR closed leases",
      buckets: [
        {
          beds: 2,
          baths: 1,
          count: 8,
          medianRent: 4500,
          medianPricePerSqft: 5,
          medianSqft: 900,
        },
      ],
    };

    const result = enrichRentRoll({
      ...baseArgs,
      rentRoll,
      aiRentEstimate,
      postRenoEstimate,
      compsOutput,
    });

    expect(result.enriched[0]!.market!.rent).toBe(4500);
    expect(result.enriched[0]!.market!.source).toBe("comps");
    // 4500 * (4200/3400) = 5559 → round50 = 5550
    expect(result.enriched[0]!.postReno!.rent).toBe(5550);
    expect(result.enriched[0]!.postReno!.rationale).toContain("lifted +");
    expect(result.enriched[0]!.postReno!.rationale).toContain("comps");
  });

  it("keeps raw postReno when comps are below the LLM number", () => {
    const rentRoll: RentRollEntryUI[] = [
      { rent: 2000, beds: 2, baths: 1, sqft: 900, unitLabel: null },
    ];
    const aiRentEstimate: RentEstimateEntryUI[] = [
      {
        beds: 2,
        baths: 1,
        estimatedRent: 3400,
        rationale: "ai",
        sqft: 900,
      },
    ];
    const postRenoEstimate: RentEstimateEntryUI[] = [
      {
        beds: 2,
        baths: 1,
        estimatedRent: 4200,
        rationale: "reno",
        sqft: 900,
      },
    ];
    const compsOutput: RentCompsOutputUI = {
      totalComps: 5,
      radiusMiles: 1,
      monthsBack: 24,
      summary: "5 SFAR closed leases",
      buckets: [
        {
          beds: 2,
          baths: 1,
          count: 5,
          medianRent: 3200,
          medianPricePerSqft: 3.5,
          medianSqft: 900,
        },
      ],
    };

    const result = enrichRentRoll({
      ...baseArgs,
      rentRoll,
      aiRentEstimate,
      postRenoEstimate,
      compsOutput,
    });

    // raw 4200 > floor (3150 * 1.235 ≈ 3892) → keep raw
    expect(result.enriched[0]!.postReno!.rent).toBe(4200);
    expect(result.enriched[0]!.postReno!.rationale).toBe("reno");
  });

  it("falls back to MIN_RENO_UPLIFT when LLM emits postReno <= aiRent", () => {
    const rentRoll: RentRollEntryUI[] = [
      { rent: 2000, beds: 2, baths: 1, sqft: null, unitLabel: null },
    ];
    // LLM slip: postReno equal to aiRent
    const aiRentEstimate: RentEstimateEntryUI[] = [
      { beds: 2, baths: 1, estimatedRent: 3500, rationale: "ai" },
    ];
    const postRenoEstimate: RentEstimateEntryUI[] = [
      { beds: 2, baths: 1, estimatedRent: 3500, rationale: "reno" },
    ];

    const result = enrichRentRoll({
      ...baseArgs,
      rentRoll,
      aiRentEstimate,
      postRenoEstimate,
      compsOutput: null,
    });

    // market = 3500 (from aiRent), floor = 3500 * 1.05 = 3675 → round50 = 3700
    expect(result.enriched[0]!.market!.rent).toBe(3500);
    expect(result.enriched[0]!.postReno!.rent).toBe(3700);
    expect(result.enriched[0]!.postReno!.rationale).toContain("lifted +5%");
  });

  it("leaves postReno alone when there is no market value", () => {
    const rentRoll: RentRollEntryUI[] = [
      { rent: 2000, beds: 5, baths: 5, sqft: null, unitLabel: null },
    ];
    const postRenoEstimate: RentEstimateEntryUI[] = [
      { beds: 5, baths: 5, estimatedRent: 9000, rationale: "reno" },
    ];

    const result = enrichRentRoll({
      ...baseArgs,
      rentRoll,
      aiRentEstimate: null,
      postRenoEstimate,
      compsOutput: null,
    });

    expect(result.enriched[0]!.market).toBeNull();
    expect(result.enriched[0]!.postReno!.rent).toBe(9000);
    expect(result.enriched[0]!.postReno!.rationale).toBe("reno");
  });
});

describe("enrichRentRoll unitMix vs rentRoll null distinction", () => {
  it("marks unitMix-derived rows as grouped (unknown rent, not vacant)", () => {
    const unitMix: UnitMixEntryUI[] = [
      { count: 3, beds: 2, baths: 1 },
      { count: 2, beds: 1, baths: 1 },
    ];

    const result = enrichRentRoll({
      rentRoll: null,
      unitMix,
      aiRentEstimate: null,
      postRenoEstimate: null,
      compsOutput: null,
      extractedTotalMonthlyRent: 7113,
    });

    expect(result.rows.every((r) => r.isGrouped)).toBe(true);
    expect(result.rows.every((r) => r.actualRent === null)).toBe(true);
    // Falls back to the disclosed aggregate rather than summing unknown rows.
    expect(result.currentTotal).toBe(7113);
  });

  it("marks a real rentRoll entry with rent:null as ungrouped (genuinely vacant)", () => {
    const rentRoll: RentRollEntryUI[] = [
      { rent: null, beds: 2, baths: 1, sqft: null, unitLabel: null },
      { rent: 2000, beds: 2, baths: 1, sqft: null, unitLabel: null },
    ];

    const result = enrichRentRoll({
      rentRoll,
      unitMix: null,
      aiRentEstimate: null,
      postRenoEstimate: null,
      compsOutput: null,
      extractedTotalMonthlyRent: null,
    });

    expect(result.rows[0]!.isGrouped).toBe(false);
    expect(result.rows[0]!.actualRent).toBeNull();
    expect(result.rows[1]!.isGrouped).toBe(false);
    expect(result.rows[1]!.actualRent).toBe(2000);
  });
});

describe("enrichRentRoll commercial units", () => {
  it("labels a commercial row, skips its residential estimate, and keeps residential totals", () => {
    // 33-Precita-shaped: two 2BR/1BA residential flats + one ground-floor
    // commercial market. Only the residential units get a market estimate.
    const rentRoll: RentRollEntryUI[] = [
      { rent: 2800, beds: 2, baths: 1, sqft: null, unitLabel: "Upper flat" },
      { rent: 2600, beds: 2, baths: 1, sqft: null, unitLabel: "Lower flat" },
      {
        rent: 3500,
        beds: null,
        baths: null,
        sqft: null,
        unitLabel: "Storefront",
        kind: "commercial",
      },
    ];
    const aiRentEstimate: RentEstimateEntryUI[] = [
      { beds: 2, baths: 1, estimatedRent: 3800, rationale: "ai" },
      { beds: 2, baths: 1, estimatedRent: 3800, rationale: "ai" },
    ];

    const result = enrichRentRoll({
      ...baseArgs,
      rentRoll,
      aiRentEstimate,
      postRenoEstimate: null,
      compsOutput: null,
    });

    // Commercial row is flagged and gets no residential market estimate.
    expect(result.enriched[2]!.isCommercial).toBe(true);
    expect(result.enriched[2]!.market).toBeNull();
    // The two residential units still resolve a market estimate — the
    // commercial row must not null out the whole market column.
    expect(result.enriched[0]!.market!.rent).toBe(3800);
    expect(result.marketTotal).toBe(7600);
    // Current total is gross (includes the $3,500 commercial rent)…
    expect(result.currentTotal).toBe(2800 + 2600 + 3500);
    // …but upside is residential-only: 7600 market − 5400 residential current.
    expect(result.monthlyUpside).toBe(7600 - 5400);
    // All three units count toward the building's unit total.
    expect(result.totalUnitCount).toBe(3);
  });
});

describe("enrichRentRoll unitMix commercial", () => {
  it("flags a commercial unitMix entry and gives it no residential estimate", () => {
    const unitMix: UnitMixEntryUI[] = [
      { count: 2, beds: 2, baths: 1, kind: "residential" },
      { count: 1, beds: null, baths: null, kind: "commercial" },
    ];
    const aiRentEstimate: RentEstimateEntryUI[] = [
      { beds: 2, baths: 1, estimatedRent: 3800, rationale: "ai" },
    ];

    const result = enrichRentRoll({
      rentRoll: null,
      unitMix,
      aiRentEstimate,
      postRenoEstimate: null,
      compsOutput: null,
      extractedTotalMonthlyRent: null,
    });

    // Residential unitMix row keeps its estimate; commercial row is flagged
    // and blank. Both are grouped (unitMix-derived).
    expect(result.enriched[0]!.isCommercial).toBe(false);
    expect(result.enriched[0]!.market!.rent).toBe(3800);
    expect(result.enriched[1]!.isCommercial).toBe(true);
    expect(result.enriched[1]!.market).toBeNull();
    // Building unit count still includes the commercial unit (2 + 1).
    expect(result.totalUnitCount).toBe(3);
  });
});
