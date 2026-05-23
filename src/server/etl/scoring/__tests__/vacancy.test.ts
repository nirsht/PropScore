import { describe, expect, it } from "vitest";
import { vacancyScore } from "../vacancy";
import type { NormalizedListing } from "../../normalize";

const baseListing = (
  overrides: Partial<NormalizedListing> = {},
): NormalizedListing => ({
  mlsId: "VAC-1",
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

describe("vacancyScore heuristic", () => {
  it("uses extracted occupancy when available", () => {
    expect(vacancyScore(baseListing(), { extractedOccupancy: 1.0 })).toBe(0);
    expect(vacancyScore(baseListing(), { extractedOccupancy: 0.0 })).toBe(100);
    expect(vacancyScore(baseListing(), { extractedOccupancy: 0.5 })).toBe(50);
  });

  it("stays neutral when remarks describe an occupied value-add deal (449 9th St regression)", () => {
    // Real-world remarks from 449 9th St. The building is occupied with
    // below-market rents — must NOT be flagged as high vacancy.
    const remarks =
      "This asset represents a strong value-add investment opportunity with approximately 42% rental upside. Current rents are notably below market, and the building offers a 7.11% cap rate with a projected pro forma cap rate of 10.83% and an impressive 7.03% cash-on-cash return.";
    const score = vacancyScore(
      baseListing({ raw: { PublicRemarks: remarks }, daysOnMls: 30 }),
    );
    // Neutral baseline is 40. Without the bug, no keywords on lines 24-25
    // match, DOM is under 60, so score should stay at 40.
    expect(score).toBe(40);
  });

  it("flags explicitly vacant remarks", () => {
    const score = vacancyScore(
      baseListing({ raw: { PublicRemarks: "Delivered vacant, no tenants in place" } }),
    );
    expect(score).toBeGreaterThanOrEqual(60);
  });

  it("reduces vacancy for fully-rented language", () => {
    const score = vacancyScore(
      baseListing({ raw: { PublicRemarks: "Fully rented, stabilized cash flow" } }),
    );
    expect(score).toBeLessThanOrEqual(20);
  });

  it("adds DOM-based vacancy pressure for stale listings", () => {
    const fresh = vacancyScore(baseListing({ daysOnMls: 30 }));
    const stale = vacancyScore(baseListing({ daysOnMls: 130 }));
    expect(stale).toBeGreaterThan(fresh);
  });
});
