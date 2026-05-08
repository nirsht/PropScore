import { describe, expect, it } from "vitest";
import {
  RENOVATION_UPSIDE,
  VALUE_ADD_WEIGHTS,
  aduCombinedScore,
  landRatioScore,
  renovationUpsideScore,
  resolveWeights,
  sizeDiscrepancyScore,
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

describe("VALUE_ADD_WEIGHTS", () => {
  it("sums to 1", () => {
    const sum =
      VALUE_ADD_WEIGHTS.vacancy +
      VALUE_ADD_WEIGHTS.location +
      VALUE_ADD_WEIGHTS.density +
      VALUE_ADD_WEIGHTS.adu +
      VALUE_ADD_WEIGHTS.motivation;
    expect(sum).toBeCloseTo(1, 9);
  });

  it("vacancy is the heaviest weight (35%)", () => {
    expect(VALUE_ADD_WEIGHTS.vacancy).toBe(0.35);
    expect(VALUE_ADD_WEIGHTS.vacancy).toBeGreaterThan(VALUE_ADD_WEIGHTS.location);
    expect(VALUE_ADD_WEIGHTS.vacancy).toBeGreaterThan(VALUE_ADD_WEIGHTS.density);
  });
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

describe("sizeDiscrepancyScore", () => {
  it("returns null when either side missing", () => {
    expect(sizeDiscrepancyScore(null, 1000)).toBeNull();
    expect(sizeDiscrepancyScore(1000, null)).toBeNull();
  });
  it("scores higher as assessor sqft exceeds MLS sqft", () => {
    expect(sizeDiscrepancyScore(1000, 1020)!).toBeLessThan(
      sizeDiscrepancyScore(1000, 1200)!,
    );
    expect(sizeDiscrepancyScore(1000, 1200)!).toBeLessThan(
      sizeDiscrepancyScore(1000, 1500)!,
    );
  });
});

describe("landRatioScore", () => {
  it("returns 100 when land dominates total value", () => {
    expect(landRatioScore(1_000_000, 50_000)).toBe(100);
  });
  it("returns lower when building dominates", () => {
    expect(landRatioScore(100_000, 1_000_000)).toBeLessThan(50);
  });
});

describe("aduCombinedScore", () => {
  it("returns null when both reads are missing", () => {
    expect(aduCombinedScore(null, null)).toBeNull();
    expect(aduCombinedScore(undefined, undefined)).toBeNull();
  });
  it("returns the available read when only one is present", () => {
    expect(aduCombinedScore(60, null)).toBe(60);
    expect(aduCombinedScore(null, 80)).toBe(80);
  });
  it("returns the max of the two reads — one new unit, whichever path is cheapest", () => {
    expect(aduCombinedScore(40, 80)).toBe(80);
    expect(aduCombinedScore(95, 50)).toBe(95);
  });
});

describe("resolveWeights", () => {
  it("returns canonical defaults when overrides omitted", () => {
    expect(resolveWeights()).toEqual(VALUE_ADD_WEIGHTS);
  });

  it("normalizes overrides to sum 1", () => {
    const r = resolveWeights({ vacancy: 1, location: 1, density: 1, adu: 1, motivation: 1 });
    expect(r.vacancy).toBeCloseTo(0.2, 9);
    expect(r.location).toBeCloseTo(0.2, 9);
  });

  it("zero overrides fall back to defaults", () => {
    const r = resolveWeights({ vacancy: 0, location: 0, density: 0, adu: 0, motivation: 0 });
    expect(r).toEqual(VALUE_ADD_WEIGHTS);
  });
});

describe("weightedValueAdd", () => {
  it("returns the input value when all components share the same score", () => {
    expect(
      weightedValueAdd({
        vacancyScore: 50,
        locationScore: 50,
        densityScore: 50,
        aduScore: 50,
        motivationScore: 50,
      }),
    ).toBeCloseTo(50, 5);
  });

  it("falls back gracefully when location/adu unknown", () => {
    const known = weightedValueAdd({
      vacancyScore: 80,
      locationScore: null,
      densityScore: 80,
      aduScore: null,
      motivationScore: 80,
    });
    expect(known).toBeCloseTo(80, 5);
  });

  it("HIGH ADU lifts value-add over no ADU read", () => {
    const noAdu = weightedValueAdd({
      vacancyScore: 50,
      locationScore: 50,
      densityScore: 50,
      aduScore: null,
      motivationScore: 50,
    });
    const highAdu = weightedValueAdd({
      vacancyScore: 50,
      locationScore: 50,
      densityScore: 50,
      aduScore: aduCombinedScore(95, 30),
      motivationScore: 50,
    });
    expect(highAdu).toBeGreaterThan(noAdu);
  });

  it("respects per-call weight overrides", () => {
    // All-vacancy weighting → result = vacancyScore
    const v = weightedValueAdd(
      {
        vacancyScore: 100,
        locationScore: 0,
        densityScore: 0,
        aduScore: 0,
        motivationScore: 0,
      },
      { vacancy: 1, location: 0, density: 0, adu: 0, motivation: 0 },
    );
    expect(v).toBeCloseTo(100, 5);
  });
});

describe("computeHeuristicScore — new signal flow", () => {
  it("propagates location score into value-add", () => {
    const noLoc = computeHeuristicScore(baseListing());
    const highLoc = computeHeuristicScore(baseListing(), { locationScore: 95 });
    expect(highLoc.locationScore).toBe(95);
    expect(highLoc.valueAddWeightedAvg).toBeGreaterThan(noLoc.valueAddWeightedAvg);
    expect(noLoc.locationScore).toBeNull();
  });

  it("uses effectiveUnits from context for density (Assessor fallback)", () => {
    const listingNoUnits = baseListing({ units: null });
    const noContext = computeHeuristicScore(listingNoUnits);
    const withAssessor = computeHeuristicScore(listingNoUnits, {
      effectiveUnits: 8,
    });
    expect(withAssessor.densityScore).toBeGreaterThan(noContext.densityScore);
  });

  it("strong detached-ADU read lifts value-add", () => {
    const baseline = computeHeuristicScore(baseListing());
    const lifted = computeHeuristicScore(baseListing(), { detachedAduScore: 95 });
    expect(lifted.aduScore).toBe(95);
    expect(lifted.valueAddWeightedAvg).toBeGreaterThan(baseline.valueAddWeightedAvg);
  });

  it("strong converted-ADU read lifts value-add even without detached", () => {
    const baseline = computeHeuristicScore(baseListing());
    const lifted = computeHeuristicScore(baseListing(), {
      detachedAduScore: 0,
      convertedAduScore: 80,
    });
    expect(lifted.aduScore).toBe(80);
    expect(lifted.valueAddWeightedAvg).toBeGreaterThan(baseline.valueAddWeightedAvg);
  });

  it("uses extractedOccupancy for vacancy when present", () => {
    const occupied = computeHeuristicScore(baseListing(), { extractedOccupancy: 1.0 });
    expect(occupied.vacancyScore).toBeLessThanOrEqual(5);
  });

  it("a heavily-vacant building scores high regardless of low location", () => {
    // Mirrors 1137 Folsom: 25/27 units vacant. Vacancy alone (35%) +
    // density (25%) should push the weighted avg high.
    const folsomLike = computeHeuristicScore(
      baseListing({ propertyType: "Multi Family", units: 27 }),
      {
        effectiveUnits: 27,
        extractedOccupancy: 2 / 27, // ~7% occupancy
        locationScore: 40,
      },
    );
    expect(folsomLike.vacancyScore).toBeGreaterThanOrEqual(90);
    expect(folsomLike.valueAddWeightedAvg).toBeGreaterThanOrEqual(60);
  });

  it("breakdown still surfaces legacy components for transparency", () => {
    const s = computeHeuristicScore(baseListing(), {
      renovationLevel: "DISTRESSED",
      mlsSqft: 4000,
      assessorSqft: 5200,
      assessorBuildingValue: 100_000,
      assessorLandValue: 1_500_000,
    });
    const components = (s.breakdown as { components: Record<string, number | null> }).components;
    expect(components.renovation).toBe(100);
    expect(components.sizeDiscrepancy).toBeGreaterThan(0);
    expect(components.landRatio).toBe(100);
  });
});
