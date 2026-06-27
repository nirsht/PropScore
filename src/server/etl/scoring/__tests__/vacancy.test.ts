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
  // DOM is derived live from postDate, so use a fresh-ish baseline that
  // doesn't trigger the >60 / >120-day vacancy bumps for tests focused
  // on remark-language signals.
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

describe("vacancyScore heuristic", () => {
  it("uses extracted occupancy when available", () => {
    expect(vacancyScore(baseListing(), { extractedOccupancy: 1.0 })).toBe(0);
    expect(vacancyScore(baseListing(), { extractedOccupancy: 0.0 })).toBe(100);
    expect(vacancyScore(baseListing(), { extractedOccupancy: 0.5 })).toBe(50);
  });

  it("treats value-add language as occupied signal (449 9th St regression)", () => {
    // Real-world remarks from 449 9th St. "Rental upside" + "below market" implies
    // tenants are in place at under-market rents — must not be flagged high.
    const remarks =
      "This asset represents a strong value-add investment opportunity with approximately 42% rental upside. Current rents are notably below market, and the building offers a 7.11% cap rate with a projected pro forma cap rate of 10.83% and an impressive 7.03% cash-on-cash return.";
    const score = vacancyScore(
      baseListing({ raw: { PublicRemarks: remarks }, daysOnMls: 30 }),
    );
    // 40 baseline − 15 (value-add) = 25.
    expect(score).toBeLessThanOrEqual(25);
  });

  it("does not flag past-tense vacant in photo context (1855 California regression)", () => {
    const remarks =
      "Don't Miss! NOTE: photos shown are when units were vacant. Currently fully occupied with strong cash flow.";
    const score = vacancyScore(baseListing({ raw: { PublicRemarks: remarks } }));
    // OCCUPIED_RE fires (-25), VACANT_RE does not (bare "vacant" no longer triggers).
    expect(score).toBeLessThanOrEqual(20);
  });

  it("treats rental upside as occupied signal (421 Cornwall regression)", () => {
    const remarks =
      "Incredible opportunity with 125% rental upside. Bring this asset to market and unlock substantial value.";
    const score = vacancyScore(baseListing({ raw: { PublicRemarks: remarks } }));
    expect(score).toBeLessThanOrEqual(30);
  });

  it("ignores casual 'vacant' mention when tenants are in place (3660 20th regression)", () => {
    const remarks =
      "Charming building. Photos were taken when one unit was vacant. Tenant occupied with long-term renters.";
    const score = vacancyScore(baseListing({ raw: { PublicRemarks: remarks } }));
    expect(score).toBeLessThanOrEqual(20);
  });

  it("treats below-market rents as occupied signal", () => {
    const remarks =
      "Rents are well below market — significant value-add play for the next operator.";
    const score = vacancyScore(baseListing({ raw: { PublicRemarks: remarks } }));
    expect(score).toBeLessThanOrEqual(30);
  });

  it("flags explicitly vacant remarks", () => {
    const score = vacancyScore(
      baseListing({ raw: { PublicRemarks: "Delivered vacant, no tenants in place" } }),
    );
    expect(score).toBeGreaterThanOrEqual(60);
  });

  it("flags 'will be delivered vacant'", () => {
    const score = vacancyScore(
      baseListing({ raw: { PublicRemarks: "Property will be delivered vacant at close of escrow" } }),
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
    // DOM is derived live from postDate, not the snapshot column.
    const now = Date.now();
    const day = 24 * 60 * 60 * 1000;
    const fresh = vacancyScore(baseListing({ postDate: new Date(now - 30 * day) }));
    const stale = vacancyScore(baseListing({ postDate: new Date(now - 130 * day) }));
    expect(stale).toBeGreaterThan(fresh);
  });
});
