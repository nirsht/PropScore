import { describe, expect, it } from "vitest";
import { rentalUpsideScore } from "../rentalUpside";

describe("rentalUpsideScore", () => {
  it("is null when either figure is missing", () => {
    expect(rentalUpsideScore({})).toBeNull();
    expect(
      rentalUpsideScore({ extractedTotalMonthlyRent: 20_000 }),
    ).toBeNull();
    expect(
      rentalUpsideScore({ extractedMarketMonthlyRent: 40_000 }),
    ).toBeNull();
  });

  it("is null when market does not exceed in-place rent", () => {
    expect(
      rentalUpsideScore({
        extractedTotalMonthlyRent: 40_000,
        extractedMarketMonthlyRent: 40_000,
      }),
    ).toBeNull();
    expect(
      rentalUpsideScore({
        extractedTotalMonthlyRent: 40_000,
        extractedMarketMonthlyRent: 35_000,
      }),
    ).toBeNull();
  });

  it("is null when in-place rent is zero or negative", () => {
    expect(
      rentalUpsideScore({
        extractedTotalMonthlyRent: 0,
        extractedMarketMonthlyRent: 40_000,
      }),
    ).toBeNull();
  });

  it("bands the gap fraction", () => {
    // 769 Haight: 22,083 → 40,833 = ~85% gap → top band.
    expect(
      rentalUpsideScore({
        extractedTotalMonthlyRent: 22_083,
        extractedMarketMonthlyRent: 40_833,
      }),
    ).toBe(95);
    // exactly 50% → top band
    expect(
      rentalUpsideScore({
        extractedTotalMonthlyRent: 20_000,
        extractedMarketMonthlyRent: 30_000,
      }),
    ).toBe(95);
    // 30% → 80
    expect(
      rentalUpsideScore({
        extractedTotalMonthlyRent: 20_000,
        extractedMarketMonthlyRent: 26_000,
      }),
    ).toBe(80);
    // 15% → 60
    expect(
      rentalUpsideScore({
        extractedTotalMonthlyRent: 20_000,
        extractedMarketMonthlyRent: 23_000,
      }),
    ).toBe(60);
    // 5% → 40
    expect(
      rentalUpsideScore({
        extractedTotalMonthlyRent: 20_000,
        extractedMarketMonthlyRent: 21_000,
      }),
    ).toBe(40);
    // 2% → floor band
    expect(
      rentalUpsideScore({
        extractedTotalMonthlyRent: 20_000,
        extractedMarketMonthlyRent: 20_400,
      }),
    ).toBe(25);
  });
});
