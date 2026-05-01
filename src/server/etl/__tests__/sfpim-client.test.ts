import { describe, expect, it } from "vitest";
import { mapSfpimRow, parseAddress, type SfpimRow } from "../sfpim-client";

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

describe("parseAddress", () => {
  it("parses a plain street address", () => {
    expect(parseAddress("1480 Clay St")).toEqual({
      streetNumber: "1480",
      streetName: "CLAY",
    });
  });

  it("parses a hyphenated address range", () => {
    expect(parseAddress("1480-1490 Clay St")).toEqual({
      streetNumber: "1480",
      streetName: "CLAY",
    });
  });

  it("strips unit suffixes", () => {
    expect(parseAddress("1480 Clay St, Apt 3")).toEqual({
      streetNumber: "1480",
      streetName: "CLAY",
    });
    expect(parseAddress("1480 Clay St #3")).toEqual({
      streetNumber: "1480",
      streetName: "CLAY",
    });
  });

  it("returns null for un-parseable input", () => {
    expect(parseAddress("")).toBeNull();
    expect(parseAddress("Clay Street")).toBeNull();
  });
});
