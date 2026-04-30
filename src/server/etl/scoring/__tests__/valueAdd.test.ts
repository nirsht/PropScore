import { describe, expect, it } from "vitest";
import {
  RENOVATION_UPSIDE,
  VALUE_ADD_WEIGHTS,
  renovationUpsideScore,
  weightedValueAdd,
} from "../valueAdd";
import { computeHeuristicScore } from "../index";
import type { NormalizedListing } from "../../normalize";

const baseListing = (
  overrides: Partial<NormalizedListing> = {},
): NormalizedListing => ({
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
  bridgeModificationTimestamp: new Date("2026-01-15"),
  raw: {},
  ...overrides,
});

describe("RENOVATION_UPSIDE", () => {
  it("orders DISTRESSED > ORIGINAL > UPDATED > RENOVATED", () => {
    expect(RENOVATION_UPSIDE.DISTRESSED).toBeGreaterThan(RENOVATION_UPSIDE.ORIGINAL);
    expect(RENOVATION_UPSIDE.ORIGINAL).toBeGreaterThan(RENOVATION_UPSIDE.UPDATED);
    expect(RENOVATION_UPSIDE.UPDATED).toBeGreaterThan(RENOVATION_UPSIDE.RENOVATED);
  });

  it("renovationUpsideScore returns null when level missing", () => {
    expect(renovationUpsideScore(null)).toBeNull();
    expect(renovationUpsideScore(undefined)).toBeNull();
    expect(renovationUpsideScore("DISTRESSED")).toBe(100);
  });
});

describe("weightedValueAdd", () => {
  it("uses 4 components when renovation is known", () => {
    const v = weightedValueAdd({
      densityScore: 100,
      vacancyScore: 100,
      motivationScore: 100,
      renovationScore: 100,
    });
    // All four maxed → exactly 100 (weights sum to 1.0)
    const sumWeights =
      VALUE_ADD_WEIGHTS.density +
      VALUE_ADD_WEIGHTS.vacancy +
      VALUE_ADD_WEIGHTS.motivation +
      VALUE_ADD_WEIGHTS.renovation;
    expect(sumWeights).toBeCloseTo(1.0, 5);
    expect(v).toBeCloseTo(100, 5);
  });

  it("falls back to a 3-component weighted mean when renovation unknown", () => {
    // With renovation=null, divisor drops to (0.25 + 0.45 + 0.10) = 0.80
    // Pure densities should still be 0..100 — i.e. all-50s should produce 50.
    const v = weightedValueAdd({
      densityScore: 50,
      vacancyScore: 50,
      motivationScore: 50,
    });
    expect(v).toBeCloseTo(50, 5);
  });

  it("does not penalize listings with unknown renovation level", () => {
    const known = weightedValueAdd({
      densityScore: 80,
      vacancyScore: 80,
      motivationScore: 80,
      renovationScore: 80,
    });
    const unknown = weightedValueAdd({
      densityScore: 80,
      vacancyScore: 80,
      motivationScore: 80,
    });
    // Equivalent inputs across known weights → same result.
    expect(unknown).toBeCloseTo(known, 5);
  });

  it("DISTRESSED > RENOVATED for the same other inputs", () => {
    const distressed = weightedValueAdd({
      densityScore: 50,
      vacancyScore: 50,
      motivationScore: 50,
      renovationScore: RENOVATION_UPSIDE.DISTRESSED,
    });
    const renovated = weightedValueAdd({
      densityScore: 50,
      vacancyScore: 50,
      motivationScore: 50,
      renovationScore: RENOVATION_UPSIDE.RENOVATED,
    });
    expect(distressed).toBeGreaterThan(renovated);
  });
});

describe("computeHeuristicScore — renovation context", () => {
  it("propagates renovation level into value-add", () => {
    const noReno = computeHeuristicScore(baseListing());
    const distressed = computeHeuristicScore(baseListing(), {
      renovationLevel: "DISTRESSED",
    });
    expect(distressed.valueAddWeightedAvg).toBeGreaterThan(noReno.valueAddWeightedAvg);
    expect(distressed.breakdown).toMatchObject({
      inputs: { renovationLevel: "DISTRESSED" },
    });
  });

  it("uses effectiveUnits from context for density (Assessor fallback)", () => {
    const listingNoUnits = baseListing({ units: null });
    const noContext = computeHeuristicScore(listingNoUnits);
    const withAssessor = computeHeuristicScore(listingNoUnits, {
      effectiveUnits: 8,
    });
    expect(withAssessor.densityScore).toBeGreaterThan(noContext.densityScore);
  });
});
