import { describe, expect, it } from "vitest";
import {
  RENOVATION_UPSIDE,
  aduPotentialScore,
  landRatioScore,
  renovationUpsideScore,
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

describe("aduPotentialScore", () => {
  it("ranks HIGH > MEDIUM > LOW", () => {
    expect(aduPotentialScore("HIGH")!).toBeGreaterThan(aduPotentialScore("MEDIUM")!);
    expect(aduPotentialScore("MEDIUM")!).toBeGreaterThan(aduPotentialScore("LOW")!);
    expect(aduPotentialScore(null)).toBeNull();
  });
});

describe("weightedValueAdd", () => {
  it("returns the input value when all components share the same score", () => {
    expect(
      weightedValueAdd({
        densityScore: 50,
        vacancyScore: 50,
        motivationScore: 50,
        renovationScore: 50,
        sizeDiscrepancyScore: 50,
        landRatioScore: 50,
        aduScore: 50,
      }),
    ).toBeCloseTo(50, 5);
  });

  it("falls back gracefully when renovation/size/land/adu unknown", () => {
    const known = weightedValueAdd({
      densityScore: 80,
      vacancyScore: 80,
      motivationScore: 80,
    });
    expect(known).toBeCloseTo(80, 5);
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

  it("HIGH ADU lifts value-add over no ADU read", () => {
    const noAdu = weightedValueAdd({
      densityScore: 50,
      vacancyScore: 50,
      motivationScore: 50,
    });
    const highAdu = weightedValueAdd({
      densityScore: 50,
      vacancyScore: 50,
      motivationScore: 50,
      aduScore: aduPotentialScore("HIGH"),
    });
    expect(highAdu).toBeGreaterThan(noAdu);
  });
});

describe("computeHeuristicScore — new context fields", () => {
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

  it("size-discrepancy lifts value-add when assessor sqft >> mls sqft", () => {
    const baseline = computeHeuristicScore(baseListing());
    const lifted = computeHeuristicScore(baseListing(), {
      mlsSqft: 4000,
      assessorSqft: 5200,
    });
    expect(lifted.valueAddWeightedAvg).toBeGreaterThan(baseline.valueAddWeightedAvg);
  });

  it("land-heavy ratio lifts value-add", () => {
    const baseline = computeHeuristicScore(baseListing());
    const lifted = computeHeuristicScore(baseListing(), {
      assessorBuildingValue: 100_000,
      assessorLandValue: 1_500_000,
    });
    expect(lifted.valueAddWeightedAvg).toBeGreaterThan(baseline.valueAddWeightedAvg);
  });

  it("HIGH ADU potential lifts value-add", () => {
    const baseline = computeHeuristicScore(baseListing());
    const lifted = computeHeuristicScore(baseListing(), { aduPotential: "HIGH" });
    expect(lifted.valueAddWeightedAvg).toBeGreaterThan(baseline.valueAddWeightedAvg);
  });

  it("uses extractedOccupancy for vacancy when present", () => {
    const occupied = computeHeuristicScore(baseListing(), { extractedOccupancy: 1.0 });
    expect(occupied.vacancyScore).toBeLessThanOrEqual(5);
  });
});
