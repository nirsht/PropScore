import { describe, expect, it } from "vitest";
import {
  deriveDetachedAduFromHeuristic,
  deriveConvertedAduFromHeuristic,
} from "../agent";
import { ListingExtractOutput } from "../schema";

describe("deriveDetachedAduFromHeuristic", () => {
  it("returns null score when lot is unknown", () => {
    expect(
      deriveDetachedAduFromHeuristic({
        units: 1,
        buildingSqft: 1500,
        lotSqft: null,
        stories: 2,
      }).score,
    ).toBeNull();
  });

  it("scores high on a generous lot", () => {
    const out = deriveDetachedAduFromHeuristic({
      units: 1,
      buildingSqft: 1500,
      lotSqft: 4000,
      stories: 2,
    });
    expect(out.score).toBeGreaterThanOrEqual(80);
  });

  it("floors to 0 for dense large multifamily", () => {
    expect(
      deriveDetachedAduFromHeuristic({
        units: 12,
        buildingSqft: 12000,
        lotSqft: 5000,
        stories: 3,
      }).score,
    ).toBe(0);
  });

  it("scores in the medium band for tight-but-plausible yards", () => {
    const out = deriveDetachedAduFromHeuristic({
      units: 4,
      buildingSqft: 3600,
      lotSqft: 2400,
      stories: 2,
    });
    expect(out.score).toBeGreaterThan(20);
    expect(out.score).toBeLessThan(80);
  });
});

describe("deriveConvertedAduFromHeuristic", () => {
  it("returns null when no signals", () => {
    expect(
      deriveConvertedAduFromHeuristic({
        basementSqft: null,
        aiHasBasement: null,
      }).score,
    ).toBeNull();
  });

  it("scores 80 for a 500+ sqft assessor basement", () => {
    expect(
      deriveConvertedAduFromHeuristic({
        basementSqft: 700,
        aiHasBasement: null,
      }),
    ).toMatchObject({ score: 80, source: "basement" });
  });

  it("scores 55 for a 300–499 sqft basement", () => {
    expect(
      deriveConvertedAduFromHeuristic({
        basementSqft: 350,
        aiHasBasement: null,
      }).score,
    ).toBe(55);
  });

  it("scores 50 with vision-only basement signal", () => {
    expect(
      deriveConvertedAduFromHeuristic({
        basementSqft: null,
        aiHasBasement: true,
      }).score,
    ).toBe(50);
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
      detachedAduScore: 55,
      detachedAduRationale: "ok",
      convertedAduScore: 70,
      convertedAduRationale: "huge basement",
      convertedAduSource: "basement" as const,
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
      detachedAduScore: null,
      detachedAduRationale: "",
      convertedAduScore: null,
      convertedAduRationale: "",
      convertedAduSource: null,
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
      detachedAduScore: null,
      detachedAduRationale: "",
      convertedAduScore: null,
      convertedAduRationale: "",
      convertedAduSource: null,
      rationale: "parsed",
    };
    expect(() => ListingExtractOutput.parse(sample)).not.toThrow();
  });
});
