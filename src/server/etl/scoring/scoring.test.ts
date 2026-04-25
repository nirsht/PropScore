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
    const fresh = computeHeuristicScore(baseListing({ daysOnMls: 5 }));
    const stale = computeHeuristicScore(baseListing({ daysOnMls: 200 }));
    expect(stale.motivationScore).toBeGreaterThan(fresh.motivationScore);
  });

  it("uses explicit occupancy in vacancyScore when present", () => {
    const occ = computeHeuristicScore(baseListing({ occupancy: 1.0 }));
    expect(occ.vacancyScore).toBeLessThanOrEqual(5);
  });
});
