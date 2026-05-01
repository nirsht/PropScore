import { describe, expect, it } from "vitest";
import { deriveAduFromHeuristic } from "../agent";
import { ListingExtractOutput } from "../schema";

describe("deriveAduFromHeuristic", () => {
  it("returns null when lot is unknown", () => {
    expect(
      deriveAduFromHeuristic({
        propertyType: "Single Family",
        units: 1,
        buildingSqft: 1500,
        lotSqft: null,
        stories: 2,
      }).potential,
    ).toBeNull();
  });

  it("scores HIGH on a generous lot", () => {
    expect(
      deriveAduFromHeuristic({
        propertyType: "Single Family",
        units: 1,
        buildingSqft: 1500,
        lotSqft: 4000,
        stories: 2,
      }).potential,
    ).toBe("HIGH");
  });

  it("scores LOW for dense large multifamily", () => {
    expect(
      deriveAduFromHeuristic({
        propertyType: "Multi Family",
        units: 12,
        buildingSqft: 12000,
        lotSqft: 5000,
        stories: 3,
      }).potential,
    ).toBe("LOW");
  });

  it("scores MEDIUM for tight-but-plausible yards", () => {
    expect(
      deriveAduFromHeuristic({
        propertyType: "Multi Family",
        units: 4,
        buildingSqft: 3600,
        lotSqft: 2400,
        stories: 2,
      }).potential,
    ).toBe("MEDIUM");
  });
});

describe("ListingExtractOutput schema", () => {
  it("accepts a tabular rent roll", () => {
    const sample = {
      unitMix: null,
      rentRoll: [
        { rent: 1284, beds: 3, baths: 2 },
        { rent: 1500, beds: 3, baths: 2 },
        { rent: 3100, beds: 3, baths: 2 },
        { rent: 7850, beds: 4, baths: 3 },
      ],
      aiRentEstimate: null,
      postRenovationRentEstimate: null,
      totalMonthlyRent: 13734,
      occupancy: null,
      recentCapex: null,
      parkingNotes: null,
      basementNotes: null,
      viewNotes: null,
      aduPotential: "MEDIUM" as const,
      aduConfidence: 0.6,
      aduRationale: "ok",
      rationale: "parsed",
    };
    expect(() => ListingExtractOutput.parse(sample)).not.toThrow();
  });

  it("accepts a unit-mix narrative", () => {
    const sample = {
      unitMix: [
        { count: 1, beds: 2, baths: 1 },
        { count: 2, beds: 2, baths: 2 },
        { count: 4, beds: 3, baths: 2 },
        { count: 2, beds: 4, baths: 2 },
      ],
      rentRoll: null,
      aiRentEstimate: null,
      postRenovationRentEstimate: null,
      totalMonthlyRent: null,
      occupancy: null,
      recentCapex: null,
      parkingNotes: null,
      basementNotes: null,
      viewNotes: null,
      aduPotential: null,
      aduConfidence: 0.0,
      aduRationale: "",
      rationale: "parsed",
    };
    expect(() => ListingExtractOutput.parse(sample)).not.toThrow();
  });

  it("accepts unit-mix entries with null beds/baths", () => {
    // Real-world: "8 unit building" with no per-unit detail.
    const sample = {
      unitMix: [
        { count: 8, beds: null, baths: null },
        { count: 1, beds: 2, baths: null },
      ],
      rentRoll: null,
      aiRentEstimate: null,
      postRenovationRentEstimate: null,
      totalMonthlyRent: null,
      occupancy: null,
      recentCapex: null,
      parkingNotes: null,
      basementNotes: null,
      viewNotes: null,
      aduPotential: null,
      aduConfidence: 0.0,
      aduRationale: "",
      rationale: "parsed",
    };
    expect(() => ListingExtractOutput.parse(sample)).not.toThrow();
  });
});
