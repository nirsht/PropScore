import { describe, expect, it } from "vitest";
import { computeHeuristicScore } from "./index";
import type { NormalizedListing } from "../normalize";

const baseListing = (overrides: Partial<NormalizedListing> = {}): NormalizedListing => ({
  mlsId: "TEST-1",
  address: "123 Test St",
  city: "San Francisco",
  state: "CA",
  postalCode: "94110",
  lat: 37.75,
  lng: -122.41,
  price: 1_000_000,
  daysOnMls: 30,
  // DOM is derived live from postDate; keep the baseline fresh so tests
  // not focused on DOM don't pick up the >60 / >120 motivation bumps.
  postDate: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000),
  listingUpdatedAt: new Date(Date.now() - 15 * 24 * 60 * 60 * 1000),
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

describe("computeHeuristicScore", () => {
  it("produces scores in [0, 100]", () => {
    const score = computeHeuristicScore(baseListing());
    for (const k of ["densityScore", "vacancyScore", "motivationScore", "valueAddWeightedAvg"] as const) {
      expect(score[k]).toBeGreaterThanOrEqual(0);
      expect(score[k]).toBeLessThanOrEqual(100);
    }
  });

  it("rewards multifamily + many units in densityScore", () => {
    const small = computeHeuristicScore(baseListing({ propertyType: "Single Family", units: 1 }));
    const big = computeHeuristicScore(baseListing({ propertyType: "Multi Family", units: 12 }));
    expect(big.densityScore).toBeGreaterThan(small.densityScore);
  });

  it("rewards long DOM in motivationScore", () => {
    // DOM is derived from postDate live; vary it via postDate, not the
    // snapshot column on Listing.
    const now = Date.now();
    const day = 24 * 60 * 60 * 1000;
    const fresh = computeHeuristicScore(
      baseListing({ postDate: new Date(now - 5 * day) }),
    );
    const stale = computeHeuristicScore(
      baseListing({ postDate: new Date(now - 200 * day) }),
    );
    expect(stale.motivationScore).toBeGreaterThan(fresh.motivationScore);
  });

  it("uses explicit occupancy in vacancyScore when present", () => {
    const occ = computeHeuristicScore(baseListing({ occupancy: 1.0 }));
    expect(occ.vacancyScore).toBeLessThanOrEqual(5);
  });

  it("emits breakdown version 8", () => {
    const score = computeHeuristicScore(baseListing());
    expect((score.breakdown as { version: number }).version).toBe(8);
  });

  it("market upside is null when neither sub-score fires", () => {
    const score = computeHeuristicScore(baseListing());
    expect(score.assessmentDeltaScore).toBeNull();
    expect(score.zoningUpsideScore).toBeNull();
    expect(score.marketUpsideScore).toBeNull();
  });

  it("market upside averages the non-null sub-scores", () => {
    // Zoning slack = (8 - 2) / 8 = 0.75 → top band → 100.
    // Assessment delta below sample threshold (no comps) → null.
    // Combined = avg([100]) = 100.
    const score = computeHeuristicScore(baseListing(), {
      effectiveUnits: 2,
      zoningMaxUnits: 8,
    });
    expect(score.zoningUpsideScore).toBe(100);
    expect(score.assessmentDeltaScore).toBeNull();
    expect(score.marketUpsideScore).toBe(100);
  });

  it("market upside scores do NOT change valueAddWeightedAvg in v1", () => {
    // Pass only context that the upside sub-scores read; avoid touching the
    // 5 weighted components (density/vacancy/motivation/location/adu).
    const baseline = computeHeuristicScore(baseListing());
    const withUpside = computeHeuristicScore(baseListing(), {
      zoningMaxUnits: 12,
      assessedValueTotal: 500_000,
      assessorSqft: 4000,
      neighborhoodMedianAssessedPerSqft: 500,
      neighborhoodCompSampleSize: 25,
    });
    expect(withUpside.marketUpsideScore).not.toBeNull();
    expect(withUpside.valueAddWeightedAvg).toBe(baseline.valueAddWeightedAvg);
  });
});
