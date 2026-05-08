import { describe, expect, it } from "vitest";
import {
  RENOVATION_UPSIDE,
  VALUE_ADD_WEIGHTS,
  aduPotentialScore,
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

describe("aduPotentialScore", () => {
  it("ranks HIGH > MEDIUM > LOW for the AI signal alone", () => {
    expect(aduPotentialScore("HIGH").score!).toBeGreaterThan(
      aduPotentialScore("MEDIUM").score!,
    );
    expect(aduPotentialScore("MEDIUM").score!).toBeGreaterThan(
      aduPotentialScore("LOW").score!,
    );
  });

  it("returns null when no AI signal AND no structural feasibility data", () => {
    expect(aduPotentialScore(null).score).toBeNull();
    expect(aduPotentialScore(undefined).score).toBeNull();
  });

  it("returns a baseline score on structural data alone (no AI signal)", () => {
    const r = aduPotentialScore(null, { landUseCategory: "MIXRES" });
    expect(r.score).not.toBeNull();
    expect(r.breakdown.boosts.landUse).toBe(15);
  });

  it("wood-frame construction adds a boost", () => {
    const without = aduPotentialScore("MEDIUM");
    const wood = aduPotentialScore("MEDIUM", {
      assessorConstructionType: "Wood Frame",
    });
    expect(wood.score!).toBeGreaterThan(without.score!);
    expect(wood.breakdown.boosts.construction).toBe(10);
  });

  it("MIXRES land use adds more than RESIDENT", () => {
    const mix = aduPotentialScore("MEDIUM", { landUseCategory: "MIXRES" });
    const res = aduPotentialScore("MEDIUM", { landUseCategory: "RESIDENT" });
    expect(mix.breakdown.boosts.landUse).toBeGreaterThan(res.breakdown.boosts.landUse);
  });

  it("same-block ADU precedent dominates over radius precedent", () => {
    const block = aduPotentialScore("MEDIUM", {
      permitsBlockAduRecentCount: 1,
      permitsRadiusAduRecentCount: 1,
    });
    const radiusOnly = aduPotentialScore("MEDIUM", {
      permitsRadiusAduRecentCount: 1,
    });
    // Block precedent +20; radius +10 only when block is 0 (no double-count).
    expect(block.breakdown.boosts.blockPrecedent).toBe(20);
    expect(block.breakdown.boosts.radius).toBe(0);
    expect(radiusOnly.breakdown.boosts.radius).toBe(10);
  });

  it("caps the score at 100", () => {
    const r = aduPotentialScore("HIGH", {
      assessorConstructionType: "Wood Frame",
      landUseCategory: "MIXRES",
      permitsOwnParcelAduCount: 1,
      permitsBlockAduRecentCount: 1,
      permitsRadiusAduRecentCount: 1,
    });
    expect(r.score).toBe(100);
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
      aduScore: aduPotentialScore("HIGH").score,
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

  it("HIGH ADU potential lifts value-add", () => {
    const baseline = computeHeuristicScore(baseListing());
    const lifted = computeHeuristicScore(baseListing(), { aduPotential: "HIGH" });
    // Without structural boosts the AI signal alone scores 80 (the new base).
    expect(lifted.aduScore).toBe(80);
    expect(lifted.valueAddWeightedAvg).toBeGreaterThan(baseline.valueAddWeightedAvg);
  });

  it("structural feasibility boosts lift the ADU score above the AI base", () => {
    const aiOnly = computeHeuristicScore(baseListing(), { aduPotential: "MEDIUM" });
    const withFeasibility = computeHeuristicScore(baseListing(), {
      aduPotential: "MEDIUM",
      assessorConstructionType: "Wood Frame",
      landUseCategory: "MIXRES",
      permitsBlockAduRecentCount: 2,
    });
    expect(withFeasibility.aduScore!).toBeGreaterThan(aiOnly.aduScore!);
    expect(withFeasibility.valueAddWeightedAvg).toBeGreaterThan(
      aiOnly.valueAddWeightedAvg,
    );
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
