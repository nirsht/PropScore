import { describe, expect, it } from "vitest";
import { assessmentDeltaScore } from "../assessmentDelta";
import type { NormalizedListing } from "../../normalize";
import type { HeuristicContext } from "../index";

const baseListing = (overrides: Partial<NormalizedListing> = {}): NormalizedListing => ({
  mlsId: "AD-1",
  address: "123 Test St",
  city: "San Francisco",
  state: "CA",
  postalCode: "94110",
  lat: 37.75,
  lng: -122.41,
  price: 2_000_000,
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
  bridgeModificationTimestamp: new Date("2026-01-15"),
  isAuction: false,
  auctionDate: null,
  raw: {},
  ...overrides,
});

const ctx = (overrides: Partial<HeuristicContext>): HeuristicContext => ({
  ...overrides,
});

describe("assessmentDeltaScore", () => {
  it("returns null when sample size is below the minimum", () => {
    const s = assessmentDeltaScore(
      baseListing(),
      ctx({
        assessedValueTotal: 500_000,
        assessorSqft: 4000,
        neighborhoodMedianAssessedPerSqft: 500,
        neighborhoodCompSampleSize: 4,
      }),
    );
    expect(s).toBeNull();
  });

  it("returns null when assessed total is missing", () => {
    const s = assessmentDeltaScore(
      baseListing(),
      ctx({
        assessorSqft: 4000,
        neighborhoodMedianAssessedPerSqft: 500,
        neighborhoodCompSampleSize: 25,
      }),
    );
    expect(s).toBeNull();
  });

  it("returns null when no basis is available", () => {
    const s = assessmentDeltaScore(
      baseListing({ units: null }),
      ctx({
        assessedValueTotal: 1_000_000,
        neighborhoodMedianAssessedPerSqft: 500,
        neighborhoodMedianAssessedPerUnit: 500_000,
        neighborhoodCompSampleSize: 25,
      }),
    );
    // No sqft basis (assessor or effective) AND no units → null.
    expect(s).toBeNull();
  });

  it("prefers sqft basis when both are available", () => {
    // Sqft basis says expected = 500 * 4000 = 2,000,000 → assessed 500,000 is
    // 75% below norm → should map to 95.
    // Unit basis says expected = 100,000 * 4 = 400,000 → assessed 500,000 is
    // 25% ABOVE norm → would map to 20.
    // The function must return 95 (sqft path), not 20 (unit path).
    const s = assessmentDeltaScore(
      baseListing(),
      ctx({
        assessedValueTotal: 500_000,
        assessorSqft: 4000,
        neighborhoodMedianAssessedPerSqft: 500,
        neighborhoodMedianAssessedPerUnit: 100_000,
        neighborhoodCompSampleSize: 25,
      }),
    );
    expect(s).toBe(95);
  });

  it("falls back to per-unit basis when sqft basis is missing", () => {
    // expected = 600,000 * 4 = 2,400,000 → assessed 1,000,000 is ~58% below → 95
    const s = assessmentDeltaScore(
      baseListing(),
      ctx({
        assessedValueTotal: 1_000_000,
        neighborhoodMedianAssessedPerUnit: 600_000,
        neighborhoodCompSampleSize: 12,
      }),
    );
    expect(s).toBe(95);
  });

  it("maps boundary deltas into the expected bands", () => {
    // delta = 0 → 20
    expect(
      assessmentDeltaScore(
        baseListing(),
        ctx({
          assessedValueTotal: 2_000_000,
          assessorSqft: 4000,
          neighborhoodMedianAssessedPerSqft: 500,
          neighborhoodCompSampleSize: 25,
        }),
      ),
    ).toBe(20);

    // delta = 0.20 → 50
    expect(
      assessmentDeltaScore(
        baseListing(),
        ctx({
          assessedValueTotal: 1_600_000,
          assessorSqft: 4000,
          neighborhoodMedianAssessedPerSqft: 500,
          neighborhoodCompSampleSize: 25,
        }),
      ),
    ).toBe(50);

    // delta = 0.40 → 75
    expect(
      assessmentDeltaScore(
        baseListing(),
        ctx({
          assessedValueTotal: 1_200_000,
          assessorSqft: 4000,
          neighborhoodMedianAssessedPerSqft: 500,
          neighborhoodCompSampleSize: 25,
        }),
      ),
    ).toBe(75);

    // delta = 0.70 → 95
    expect(
      assessmentDeltaScore(
        baseListing(),
        ctx({
          assessedValueTotal: 600_000,
          assessorSqft: 4000,
          neighborhoodMedianAssessedPerSqft: 500,
          neighborhoodCompSampleSize: 25,
        }),
      ),
    ).toBe(95);
  });

  it("returns the floor (20) when assessed exceeds expected, never null", () => {
    const s = assessmentDeltaScore(
      baseListing(),
      ctx({
        assessedValueTotal: 5_000_000,
        assessorSqft: 4000,
        neighborhoodMedianAssessedPerSqft: 500,
        neighborhoodCompSampleSize: 25,
      }),
    );
    expect(s).toBe(20);
  });
});
