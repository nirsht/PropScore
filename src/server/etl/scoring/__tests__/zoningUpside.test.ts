import { describe, expect, it } from "vitest";
import { zoningUpsideScore } from "../zoningUpside";
import type { NormalizedListing } from "../../normalize";

const baseListing = (overrides: Partial<NormalizedListing> = {}): NormalizedListing => ({
  mlsId: "ZU-1",
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
  units: 3,
  beds: 6,
  baths: 3,
  occupancy: null,
  yearBuilt: 1925,
  stories: 3,
  bridgeModificationTimestamp: new Date("2026-01-15"),
  raw: {},
  ...overrides,
});

describe("zoningUpsideScore", () => {
  it("returns null when zoningMaxUnits is missing", () => {
    expect(zoningUpsideScore(baseListing(), {})).toBeNull();
    expect(
      zoningUpsideScore(baseListing(), { zoningMaxUnits: null }),
    ).toBeNull();
  });

  it("returns null when current units cannot be determined", () => {
    expect(
      zoningUpsideScore(baseListing({ units: null }), { zoningMaxUnits: 6 }),
    ).toBeNull();
  });

  it("4-of-6 lands in the mid band (65)", () => {
    // slack = 0.333 → falls into [0.25, 0.5) band → 65.
    const s = zoningUpsideScore(baseListing({ units: 4 }), {
      zoningMaxUnits: 6,
      effectiveUnits: 4,
    });
    expect(s).toBe(65);
  });

  it("3-of-6 lands in the upper band (85)", () => {
    // slack = 0.5 → boundary lands in [0.5, 0.75) band → 85.
    const s = zoningUpsideScore(baseListing({ units: 3 }), {
      zoningMaxUnits: 6,
      effectiveUnits: 3,
    });
    expect(s).toBe(85);
  });

  it("2-of-8 lands in the top band (100)", () => {
    const s = zoningUpsideScore(baseListing({ units: 2 }), {
      zoningMaxUnits: 8,
      effectiveUnits: 2,
    });
    expect(s).toBe(100);
  });

  it("4-of-4 (fully built out) maps to 10", () => {
    const s = zoningUpsideScore(baseListing({ units: 4 }), {
      zoningMaxUnits: 4,
      effectiveUnits: 4,
    });
    expect(s).toBe(10);
  });

  it("legal-nonconforming (current > max) clamps to 10, never negative", () => {
    const s = zoningUpsideScore(baseListing({ units: 5 }), {
      zoningMaxUnits: 3,
      effectiveUnits: 5,
    });
    expect(s).toBe(10);
  });

  it("near-max slack (5-of-6) lands in the lowest non-floor band (35)", () => {
    const s = zoningUpsideScore(baseListing({ units: 5 }), {
      zoningMaxUnits: 6,
      effectiveUnits: 5,
    });
    expect(s).toBe(35);
  });
});
