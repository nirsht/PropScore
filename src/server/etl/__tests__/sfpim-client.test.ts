import { describe, expect, it } from "vitest";
import {
  mapSfpimRow,
  parseAddress,
  normalizeSuffix,
  scoreCandidate,
  type AddressParts,
  type SfpimRow,
} from "../sfpim-client";

const parts = (over: Partial<AddressParts> = {}): AddressParts => ({
  streetNumber: "67",
  streetName: "HAIGHT",
  streetSuffix: "ST",
  unitNumber: null,
  postalCode: "94102",
  listingSqft: null,
  listingUnits: null,
  ...over,
});

const row = (loc: string, over: Partial<SfpimRow> = {}): SfpimRow => ({
  parcel_number: "0851012",
  property_location: loc,
  ...over,
});

describe("mapSfpimRow", () => {
  it("maps a representative parcel row", () => {
    // Real 2024 row for parcel 0216013 — 1480-1490 Clay St:
    // 9,995 building sqft, 7 units, 4 stories, 42 rooms, built 1909.
    const row: SfpimRow = {
      parcel_number: "0216013",
      block: "0216",
      lot: "013",
      property_location: "1490 1480 CLAY                ST0000",
      property_area: "9995.0",
      lot_area: "3397.0",
      year_property_built: "1909",
      number_of_stories: "4.0",
      number_of_units: "7.0",
      number_of_rooms: "42.0",
      number_of_bedrooms: "21.0",
      number_of_bathrooms: "7.0",
      use_definition: "Multi-Family Residential",
      construction_type: "D",
      basement_area: "1200.0",
      closed_roll_year: "2024",
    };
    const out = mapSfpimRow(row);
    expect(out.blockLot).toBe("0216013");
    expect(out.buildingSqft).toBe(9995);
    expect(out.lotSqft).toBe(3397);
    expect(out.yearBuilt).toBe(1909);
    expect(out.stories).toBe(4);
    expect(out.units).toBe(7);
    expect(out.rooms).toBe(42);
    expect(out.bedrooms).toBe(21);
    expect(out.bathrooms).toBe(7);
    expect(out.useType).toBe("Multi-Family Residential");
    expect(out.basement).toBe("1200 sqft");
  });

  it("renders zero/missing basement_area as null", () => {
    const zero = mapSfpimRow({ parcel_number: "0001001", basement_area: "0.0" });
    expect(zero.basement).toBeNull();
    const missing = mapSfpimRow({ parcel_number: "0001001" });
    expect(missing.basement).toBeNull();
  });

  it("treats 0 / empty / non-numeric as null for positive-only fields", () => {
    const out = mapSfpimRow({
      parcel_number: "0001001",
      property_area: "0",
      lot_area: "",
      year_property_built: "1900",
      number_of_units: "n/a",
    });
    expect(out.buildingSqft).toBeNull();
    expect(out.lotSqft).toBeNull();
    expect(out.yearBuilt).toBe(1900);
    expect(out.units).toBeNull();
  });

  it("trims whitespace and treats blanks as null on string fields", () => {
    const out = mapSfpimRow({
      parcel_number: "0001001",
      use_definition: "   ",
      construction_type: "Steel ",
    });
    expect(out.useType).toBeNull();
    expect(out.constructionType).toBe("Steel");
  });
});

describe("normalizeSuffix", () => {
  it("maps spellings to the 2-letter dataset codes", () => {
    expect(normalizeSuffix("Street")).toBe("ST");
    expect(normalizeSuffix("St.")).toBe("ST");
    expect(normalizeSuffix("Avenue")).toBe("AV");
    expect(normalizeSuffix("Ave")).toBe("AV");
    expect(normalizeSuffix("Boulevard")).toBe("BL");
    expect(normalizeSuffix("Way")).toBe("WY");
    expect(normalizeSuffix("Terrace")).toBe("TR");
  });

  it("returns null for unknown / empty", () => {
    expect(normalizeSuffix(null)).toBeNull();
    expect(normalizeSuffix("Lagoon")).toBeNull();
  });
});

describe("parseAddress", () => {
  it("parses a plain street address with suffix and zip", () => {
    expect(parseAddress("67 Haight Street, San Francisco CA 94102")).toEqual({
      streetNumber: "67",
      streetName: "HAIGHT",
      streetSuffix: "ST",
      unitNumber: null,
      postalCode: "94102",
    });
  });

  it("keeps the range as-is in streetNumber so both endpoints can be matched", () => {
    expect(parseAddress("1480-1490 Clay St")).toMatchObject({
      streetNumber: "1480-1490",
      streetName: "CLAY",
      streetSuffix: "ST",
    });
  });

  it("strips unit suffixes and captures the unit number", () => {
    expect(parseAddress("181 Fremont Street # 54J, San Francisco CA 94105")).toEqual({
      streetNumber: "181",
      streetName: "FREMONT",
      streetSuffix: "ST",
      unitNumber: "54J",
      postalCode: "94105",
    });
    expect(parseAddress("1480 Clay St, Apt 3")).toMatchObject({
      streetNumber: "1480",
      streetName: "CLAY",
      streetSuffix: "ST",
      unitNumber: "3",
    });
  });

  it("handles numeric street names", () => {
    expect(parseAddress("252 9th Street, San Francisco CA 94103")).toMatchObject({
      streetNumber: "252",
      streetName: "9TH",
      streetSuffix: "ST",
    });
  });

  it("falls back to no-suffix when none is present", () => {
    expect(parseAddress("1480 Clay")).toMatchObject({
      streetNumber: "1480",
      streetName: "CLAY",
      streetSuffix: null,
    });
  });

  it("returns null for un-parseable input", () => {
    expect(parseAddress("")).toBeNull();
    expect(parseAddress("Clay Street")).toBeNull();
  });
});

describe("scoreCandidate", () => {
  it("accepts the exact single-parcel match", () => {
    const s = scoreCandidate(row("0000 0067 HAIGHT              ST0000"), parts());
    expect(s).not.toBeNull();
    expect(s!.score).toBeGreaterThanOrEqual(75); // base + suffix
    expect(s!.reasons).toContain("num+name");
    expect(s!.reasons).toContain("suffix");
  });

  it("accepts a range parcel where the listing's number is the lower endpoint", () => {
    const s = scoreCandidate(row("0552 0550 GRANT               AV0000"), parts({
      streetNumber: "550",
      streetName: "GRANT",
      streetSuffix: "AV",
    }));
    expect(s).not.toBeNull();
    expect(s!.reasons).toContain("num+name");
  });

  it("rejects substring-number collisions (the original bug)", () => {
    // 67 HAIGHT must NOT match 167/267/1067 HAIGHT.
    for (const loc of [
      "0000 0167 HAIGHT              ST0000",
      "0000 0267 HAIGHT              ST0000",
      "0000 1067 HAIGHT              ST0000",
    ]) {
      expect(scoreCandidate(row(loc), parts())).toBeNull();
    }
  });

  it("rejects substring-name collisions (OAK vs OAKDALE)", () => {
    const s = scoreCandidate(
      row("0000 1371 OAKDALE             AV0000"),
      parts({ streetNumber: "371", streetName: "OAK", streetSuffix: "ST" }),
    );
    expect(s).toBeNull();
  });

  it("rejects rows with no property_location", () => {
    expect(scoreCandidate(row(""), parts())).toBeNull();
  });

  it("bonus when sqft is in the 0.5..2x window (favors condo unit over parent building)", () => {
    const condoUnit = row("0000 0181 FREMONT             ST054J", { property_area: "1900" });
    const parentTower = row("0000 0181 FREMONT             ST0000", { property_area: "432000" });
    const p = parts({
      streetNumber: "181",
      streetName: "FREMONT",
      streetSuffix: "ST",
      listingSqft: 1926,
    });
    const a = scoreCandidate(condoUnit, p);
    const b = scoreCandidate(parentTower, p);
    expect(a).not.toBeNull();
    expect(b).not.toBeNull();
    expect(a!.score).toBeGreaterThan(b!.score);
    expect(a!.reasons).toContain("sqft-close");
  });
});
