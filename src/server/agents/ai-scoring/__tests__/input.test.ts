import { describe, expect, it } from "vitest";
import {
  buildAIScoringInput,
  hashAIScoringInput,
  type AIScoringListing,
} from "../input";

function listing(overrides: Partial<AIScoringListing> = {}): AIScoringListing {
  return {
    mlsId: "TEST-1",
    address: "123 Test St",
    city: "San Francisco",
    state: "CA",
    postalCode: "94110",
    lat: 37.75,
    lng: -122.41,
    price: 1_000_000,
    daysOnMls: 30,
    postDate: new Date("2026-01-01"),
    listingUpdatedAt: new Date("2026-01-15"),
    status: "Active",
    propertyType: "Multi Family",
    sqft: 4000,
    lotSizeSqft: null,
    units: 4,
    beds: 8,
    baths: 4,
    occupancy: null,
    yearBuilt: 1925,
    stories: 3,
    assessorBuildingSqft: 4600,
    assessorLandValue: 1_200_000,
    assessorBuildingValue: 400_000,
    assessorUnits: 4,
    assessorStories: 3,
    assessorRooms: 18,
    assessorBedrooms: 8,
    extractedUnitMix: null,
    extractedRentRoll: null,
    extractedTotalMonthlyRent: null,
    extractedOccupancy: null,
    recentCapex: null,
    detachedAduScore: null,
    attachedAduScore: null,
    convertedAduScore: null,
    convertedAduSource: null,
    renovationLevel: null,
    renovationConfidence: null,
    raw: { PublicRemarks: "Charming Edwardian." },
    score: null,
    ...overrides,
  } as unknown as AIScoringListing;
  // (Cast: AIScoringListing has the full Prisma Listing/Score shape with
  // many fields we don't need for these tests; helper only reads a subset.)
}

describe("buildAIScoringInput", () => {
  it("derives sqftDiscrepancyRatio, landValuePct, computedRoomsMls", () => {
    const slim = buildAIScoringInput(listing());
    expect(slim.sqftDiscrepancyRatio).toBeCloseTo(4600 / 4000, 5);
    // land 1.2M / (1.2M + 0.4M) = 0.75
    expect(slim.landValuePct).toBeCloseTo(0.75, 5);
    // beds 8 + units 4 * 2 = 16
    expect(slim.computedRoomsMls).toBe(16);
  });

  it("pulls PublicRemarks out of raw", () => {
    expect(buildAIScoringInput(listing()).publicRemarks).toBe("Charming Edwardian.");
  });

  it("carries the canonical weights and a null baseline when unscored", () => {
    const slim = buildAIScoringInput(listing());
    expect(slim.valueAddWeights.vacancy).toBe(0.3);
    expect(slim.baselineValueAdd).toBeNull();
    expect(slim.heuristicComponents.vacancyScore).toBeNull();
  });

  it("computes baselineValueAdd from present heuristic components", () => {
    // Only vacancy + density present → weighted avg drops null components
    // from the divisor: (10*.30 + 80*.15) / (.30 + .15) = 33.33.
    const slim = buildAIScoringInput(
      listing({
        score: {
          listingMlsId: "TEST-1",
          vacancyScore: 10,
          densityScore: 80,
          locationScore: null,
          rehabScore: null,
          aduScore: null,
          motivationScore: null,
        } as unknown as AIScoringListing["score"],
      }),
    );
    expect(slim.heuristicComponents.densityScore).toBe(80);
    expect(slim.baselineValueAdd).toBeCloseTo(33.3, 1);
  });
});

describe("hashAIScoringInput", () => {
  it("is deterministic for the same input", () => {
    const a = hashAIScoringInput(buildAIScoringInput(listing()));
    const b = hashAIScoringInput(buildAIScoringInput(listing()));
    expect(a).toBe(b);
  });

  it("changes when price changes", () => {
    const a = hashAIScoringInput(buildAIScoringInput(listing()));
    const b = hashAIScoringInput(buildAIScoringInput(listing({ price: 1_100_000 })));
    expect(a).not.toBe(b);
  });

  it("changes when assessor sqft changes (downstream of slim derivation)", () => {
    const a = hashAIScoringInput(buildAIScoringInput(listing()));
    const b = hashAIScoringInput(
      buildAIScoringInput(listing({ assessorBuildingSqft: 5200 } as Partial<AIScoringListing>)),
    );
    expect(a).not.toBe(b);
  });

  it("ignores heuristic drift (baseline/components) so re-score isn't forced nightly", () => {
    const a = hashAIScoringInput(buildAIScoringInput(listing()));
    const b = hashAIScoringInput(
      buildAIScoringInput(
        listing({
          score: {
            listingMlsId: "TEST-1",
            vacancyScore: 10,
            densityScore: 80,
          } as unknown as AIScoringListing["score"],
        }),
      ),
    );
    expect(a).toBe(b);
  });

  it("re-hashes when scoringVersion is bumped (forces one-shot full re-score)", () => {
    const slim = buildAIScoringInput(listing());
    const before = hashAIScoringInput(slim);
    const after = hashAIScoringInput({ ...slim, scoringVersion: slim.scoringVersion + 1 });
    expect(before).not.toBe(after);
  });

  it("ignores previousScore (would otherwise force re-score every run)", () => {
    const withoutScore = hashAIScoringInput(buildAIScoringInput(listing()));
    const withScore = hashAIScoringInput(
      buildAIScoringInput(
        listing({
          score: {
            listingMlsId: "TEST-1",
            valueAddWeightedAvg: 72,
          } as unknown as AIScoringListing["score"],
        }),
      ),
    );
    expect(withoutScore).toBe(withScore);
  });
});
