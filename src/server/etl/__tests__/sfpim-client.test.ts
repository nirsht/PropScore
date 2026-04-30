import { describe, expect, it } from "vitest";
import { mapSfpimRow, parseAddress, type SfpimRow } from "../sfpim-client";

describe("mapSfpimRow", () => {
  it("maps a representative parcel row", () => {
    // The screenshotted record for parcel 0216013 — 1480-1490 Clay St:
    // 9,995 building sqft, 7 units, 4 stories, 42 rooms, built 1909.
    const row: SfpimRow = {
      blklot: "0216013",
      block: "0216",
      lot: "013",
      property_location: "1480 CLAY ST",
      bldg_sqft: "9995",
      lot_area: "3397",
      year_built: "1909",
      num_stories: "4",
      num_units: "7",
      num_rooms: "42",
      num_bedrooms: "14",
      num_bathrooms: "7",
      use_definition: "Apartment 5+ Units",
      construction_type: "Wood Frame",
      basement: "Full Basement",
    };
    const out = mapSfpimRow(row);
    expect(out.blockLot).toBe("0216013");
    expect(out.buildingSqft).toBe(9995);
    expect(out.lotSqft).toBe(3397);
    expect(out.yearBuilt).toBe(1909);
    expect(out.stories).toBe(4);
    expect(out.units).toBe(7);
    expect(out.rooms).toBe(42);
    expect(out.bedrooms).toBe(14);
    expect(out.bathrooms).toBe(7);
    expect(out.useType).toBe("Apartment 5+ Units");
    expect(out.basement).toBe("Full Basement");
  });

  it("treats 0 / empty / non-numeric as null for positive-only fields", () => {
    const out = mapSfpimRow({
      blklot: "0001001",
      bldg_sqft: "0",
      lot_area: "",
      year_built: "1900",
      num_units: "n/a",
    });
    expect(out.buildingSqft).toBeNull();
    expect(out.lotSqft).toBeNull();
    expect(out.yearBuilt).toBe(1900);
    expect(out.units).toBeNull();
  });

  it("trims whitespace and treats blanks as null on string fields", () => {
    const out = mapSfpimRow({
      blklot: "0001001",
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
