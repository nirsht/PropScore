import { describe, expect, it } from "vitest";
import {
  RENOVATION_UPSIDE,
  VALUE_ADD_WEIGHTS,
  aduCombinedScore,
  applyAduFeasibilityBoosts,
  landRatioScore,
  rehabScore,
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
  isAuction: false,
  auctionDate: null,
  raw: {},
  ...overrides,
});

describe("VALUE_ADD_WEIGHTS", () => {
  it("sums to 1", () => {
    const sum =
      VALUE_ADD_WEIGHTS.vacancy +
      VALUE_ADD_WEIGHTS.location +
      VALUE_ADD_WEIGHTS.density +
      VALUE_ADD_WEIGHTS.rehab +
      VALUE_ADD_WEIGHTS.adu +
      VALUE_ADD_WEIGHTS.motivation;
    expect(sum).toBeCloseTo(1, 9);
  });

  it("vacancy is the heaviest weight (30%)", () => {
    expect(VALUE_ADD_WEIGHTS.vacancy).toBe(0.30);
    expect(VALUE_ADD_WEIGHTS.vacancy).toBeGreaterThan(VALUE_ADD_WEIGHTS.location);
    expect(VALUE_ADD_WEIGHTS.vacancy).toBeGreaterThan(VALUE_ADD_WEIGHTS.density);
  });

  it("matches the documented ratio 30/20/15/15/15/5 (v8)", () => {
    expect(VALUE_ADD_WEIGHTS).toEqual({
      vacancy: 0.30,
      location: 0.20,
      density: 0.15,
      rehab: 0.15,
      adu: 0.15,
      motivation: 0.05,
    });
  });

  it("rehab/adu/density bracket together at 15% each", () => {
    expect(VALUE_ADD_WEIGHTS.rehab).toBe(VALUE_ADD_WEIGHTS.adu);
    expect(VALUE_ADD_WEIGHTS.rehab).toBe(VALUE_ADD_WEIGHTS.density);
    expect(VALUE_ADD_WEIGHTS.rehab).toBeGreaterThan(VALUE_ADD_WEIGHTS.motivation);
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
  it("returns null when all reads are missing", () => {
    expect(aduCombinedScore(null, null, null)).toBeNull();
    expect(aduCombinedScore(undefined, undefined, undefined)).toBeNull();
  });
  it("returns the available read when only one is present", () => {
    expect(aduCombinedScore(60, null, null)).toBe(60);
    expect(aduCombinedScore(null, 70, null)).toBe(70);
    expect(aduCombinedScore(null, null, 80)).toBe(80);
  });
  it("returns the max of all three reads — one new unit, whichever path is cheapest", () => {
    expect(aduCombinedScore(40, 30, 80)).toBe(80);
    expect(aduCombinedScore(40, 90, 60)).toBe(90);
    expect(aduCombinedScore(95, 50, 50)).toBe(95);
  });
});

describe("applyAduFeasibilityBoosts", () => {
  it("passes the AI base through when no structural data", () => {
    const r = applyAduFeasibilityBoosts(72);
    expect(r.score).toBe(72);
    expect(r.breakdown.aiBase).toBe(72);
    expect(r.breakdown.base).toBe(72);
  });

  it("returns null when no AI base AND no structural feasibility data", () => {
    expect(applyAduFeasibilityBoosts(null).score).toBeNull();
  });

  it("returns a baseline score on structural data alone (no AI base)", () => {
    const r = applyAduFeasibilityBoosts(null, { landUseCategory: "MIXRES" });
    expect(r.score).not.toBeNull();
    // Synthetic 40 baseline + 15 MIXRES boost.
    expect(r.breakdown.base).toBe(40);
    expect(r.breakdown.boosts.landUse).toBe(15);
  });

  it("wood-frame construction adds a boost", () => {
    const without = applyAduFeasibilityBoosts(50);
    const wood = applyAduFeasibilityBoosts(50, {
      assessorConstructionType: "Wood Frame",
    });
    expect(wood.score!).toBeGreaterThan(without.score!);
    expect(wood.breakdown.boosts.construction).toBe(10);
  });

  it("MIXRES land use adds more than RESIDENT", () => {
    const mix = applyAduFeasibilityBoosts(50, { landUseCategory: "MIXRES" });
    const res = applyAduFeasibilityBoosts(50, { landUseCategory: "RESIDENT" });
    expect(mix.breakdown.boosts.landUse).toBeGreaterThan(res.breakdown.boosts.landUse);
  });

  it("same-block ADU precedent dominates over radius precedent", () => {
    const block = applyAduFeasibilityBoosts(50, {
      permitsBlockAduRecentCount: 1,
      permitsRadiusAduRecentCount: 1,
    });
    const radiusOnly = applyAduFeasibilityBoosts(50, {
      permitsRadiusAduRecentCount: 1,
    });
    // Block precedent +20; radius +10 only when block is 0 (no double-count).
    expect(block.breakdown.boosts.blockPrecedent).toBe(20);
    expect(block.breakdown.boosts.radius).toBe(0);
    expect(radiusOnly.breakdown.boosts.radius).toBe(10);
  });

  it("caps the score at 100", () => {
    const r = applyAduFeasibilityBoosts(80, {
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
    const r = resolveWeights({
      vacancy: 1,
      location: 1,
      density: 1,
      rehab: 1,
      adu: 1,
      motivation: 1,
    });
    expect(r.vacancy).toBeCloseTo(1 / 6, 9);
    expect(r.rehab).toBeCloseTo(1 / 6, 9);
  });

  it("zero overrides fall back to defaults", () => {
    const r = resolveWeights({
      vacancy: 0,
      location: 0,
      density: 0,
      rehab: 0,
      adu: 0,
      motivation: 0,
    });
    expect(r).toEqual(VALUE_ADD_WEIGHTS);
  });
});

describe("weightedValueAdd", () => {
  it("applies the documented 30/20/15/15/15/5 weights to mixed components", () => {
    // 0.30·70 + 0.20·80 + 0.15·60 + 0.15·55 + 0.15·50 + 0.05·40
    //   = 21 + 16 + 9 + 8.25 + 7.5 + 2 = 63.75
    expect(
      weightedValueAdd({
        vacancyScore: 70,
        locationScore: 80,
        densityScore: 60,
        rehabScore: 55,
        aduScore: 50,
        motivationScore: 40,
      }),
    ).toBeCloseTo(63.75, 5);
  });

  it("returns the input value when all components share the same score", () => {
    expect(
      weightedValueAdd({
        vacancyScore: 50,
        locationScore: 50,
        densityScore: 50,
        rehabScore: 50,
        aduScore: 50,
        motivationScore: 50,
      }),
    ).toBeCloseTo(50, 5);
  });

  it("falls back gracefully when location/rehab/adu unknown", () => {
    const known = weightedValueAdd({
      vacancyScore: 80,
      locationScore: null,
      densityScore: 80,
      rehabScore: null,
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
      rehabScore: 50,
      aduScore: null,
      motivationScore: 50,
    });
    const highAdu = weightedValueAdd({
      vacancyScore: 50,
      locationScore: 50,
      densityScore: 50,
      rehabScore: 50,
      aduScore: aduCombinedScore(95, 30, 30),
      motivationScore: 50,
    });
    expect(highAdu).toBeGreaterThan(noAdu);
  });

  it("HIGH rehab lifts value-add over no rehab read", () => {
    const noRehab = weightedValueAdd({
      vacancyScore: 50,
      locationScore: 50,
      densityScore: 50,
      rehabScore: null,
      aduScore: 50,
      motivationScore: 50,
    });
    const highRehab = weightedValueAdd({
      vacancyScore: 50,
      locationScore: 50,
      densityScore: 50,
      rehabScore: 95,
      aduScore: 50,
      motivationScore: 50,
    });
    expect(highRehab).toBeGreaterThan(noRehab);
  });

  it("respects per-call weight overrides", () => {
    // All-vacancy weighting → result = vacancyScore
    const v = weightedValueAdd(
      {
        vacancyScore: 100,
        locationScore: 0,
        densityScore: 0,
        rehabScore: 0,
        aduScore: 0,
        motivationScore: 0,
      },
      { vacancy: 1, location: 0, density: 0, rehab: 0, adu: 0, motivation: 0 },
    );
    expect(v).toBeCloseTo(100, 5);
  });
});

describe("rehabScore", () => {
  it("returns null when every input is missing", () => {
    expect(rehabScore().score).toBeNull();
    expect(rehabScore({}).score).toBeNull();
  });

  it("anchors on RENOVATION_UPSIDE when no confidence is supplied", () => {
    expect(rehabScore({ renovationLevel: "DISTRESSED" }).score).toBe(100);
    expect(rehabScore({ renovationLevel: "RENOVATED" }).score).toBe(10);
  });

  it("confidence=0 pulls the score all the way to neutral 50", () => {
    const r = rehabScore({
      renovationLevel: "DISTRESSED",
      renovationConfidence: 0,
    });
    expect(r.score).toBe(50);
  });

  it("low confidence dampens the read toward 50", () => {
    // base 100, confidence 0.5 → 50 + (100-50)*0.5 = 75.
    const r = rehabScore({
      renovationLevel: "DISTRESSED",
      renovationConfidence: 0.5,
    });
    expect(r.score).toBeCloseTo(75, 5);
  });

  it("falls back to neutral 50 when level is null but condition signals exist", () => {
    // No level, but 3+ open violations → 50 (baseline) + 10 (violations boost) = 60.
    const r = rehabScore({
      renovationLevel: null,
      codeViolationsOpenCount: 4,
    });
    expect(r.score).toBe(60);
  });

  it("DISTRESSED + open violations + size discrepancy stacks boosts (capped at +15)", () => {
    // base 100, no confidence dampening, full +15 cap.
    const r = rehabScore({
      renovationLevel: "DISTRESSED",
      codeViolationsOpenCount: 5,
      sizeDiscrepancyScore: 80,
      landRatioScore: 90,
    });
    expect(r.score).toBe(100); // 100 + 15 clamped to 100
    expect(r.breakdown.boosts.violations).toBe(10);
    expect(r.breakdown.boosts.sizeDiscrepancy).toBe(5);
    expect(r.breakdown.boosts.landRatio).toBe(5);
  });

  it("RENOVATED with no boosts stays at the floor", () => {
    const r = rehabScore({ renovationLevel: "RENOVATED" });
    expect(r.score).toBe(10);
  });

  it("RENOVATED + violations lifts off the floor (the next owner inherits work)", () => {
    const renovated = rehabScore({ renovationLevel: "RENOVATED" });
    const renovatedWithViolations = rehabScore({
      renovationLevel: "RENOVATED",
      codeViolationsOpenCount: 1,
    });
    expect(renovatedWithViolations.score!).toBeGreaterThan(renovated.score!);
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

  it("structural feasibility boosts lift the ADU score above the AI base", () => {
    const aiOnly = computeHeuristicScore(baseListing(), {
      detachedAduScore: 50,
      convertedAduScore: 50,
    });
    const withFeasibility = computeHeuristicScore(baseListing(), {
      detachedAduScore: 50,
      convertedAduScore: 50,
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

  it("breakdown surfaces the rehab driver and the raw signals that feed it", () => {
    const s = computeHeuristicScore(baseListing(), {
      renovationLevel: "DISTRESSED",
      mlsSqft: 4000,
      assessorSqft: 5200,
      assessorBuildingValue: 100_000,
      assessorLandValue: 1_500_000,
    });
    const components = (s.breakdown as { components: Record<string, number | null> }).components;
    expect(components.rehab).toBeGreaterThan(0);
    expect(components.sizeDiscrepancy).toBeGreaterThan(0);
    expect(components.landRatio).toBe(100);
    // rehab should be at the ceiling (DISTRESSED 100 + boosts clamp).
    expect(s.rehabScore).toBe(100);
  });
});
