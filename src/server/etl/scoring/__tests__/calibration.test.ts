import { describe, expect, it } from "vitest";
import { CALIB_RADIUS_M } from "../location";
import {
  EXACT_MATCH_M,
  calibrationInputsFor,
  haversineMeters,
  pointKeyFor,
  type LoadedCalibration,
} from "../calibration";

// A reference point in the Mission (≈ 3660 20th St).
const LAT = 37.7587;
const LNG = -122.4265;

/** Metres east of a point, in degrees of longitude at this latitude. */
function lngOffsetForMeters(meters: number, atLat: number): number {
  const metersPerDegLng = 111_320 * Math.cos((atLat * Math.PI) / 180);
  return meters / metersPerDegLng;
}

describe("haversineMeters", () => {
  it("returns ~0 for identical points", () => {
    expect(haversineMeters(LAT, LNG, LAT, LNG)).toBeCloseTo(0, 5);
  });

  it("measures a known east-west offset within a few percent", () => {
    const got = haversineMeters(LAT, LNG, LAT, LNG + lngOffsetForMeters(300, LAT));
    expect(got).toBeGreaterThan(285);
    expect(got).toBeLessThan(315);
  });
});

describe("pointKeyFor", () => {
  it("rounds to 5 decimals so near-identical coords collapse to one key", () => {
    expect(pointKeyFor(37.758712, -122.426531)).toBe(pointKeyFor(37.758709, -122.426534));
  });
});

describe("calibrationInputsFor", () => {
  const cal = (lat: number, lng: number, calibratedScore: number): LoadedCalibration => ({
    id: `${lat},${lng}`,
    lat,
    lng,
    calibratedScore,
  });

  it("treats a coincident calibration as an exact override", () => {
    const { exact, nearby } = calibrationInputsFor(LAT, LNG, [cal(LAT, LNG, 70)]);
    expect(exact).toEqual({ calibratedScore: 70 });
    expect(nearby).toHaveLength(1);
  });

  it("does not treat a calibration just beyond EXACT_MATCH_M as exact", () => {
    const justOutside = LNG + lngOffsetForMeters(EXACT_MATCH_M + 5, LAT);
    const { exact, nearby } = calibrationInputsFor(LAT, LNG, [cal(LAT, justOutside, 70)]);
    expect(exact).toBeNull();
    expect(nearby).toHaveLength(1);
    expect(nearby[0]!.calibratedScore).toBe(70);
  });

  it("includes calibrations within the radius and excludes those beyond it", () => {
    const inside = cal(LAT, LNG + lngOffsetForMeters(CALIB_RADIUS_M - 50, LAT), 60);
    const outside = cal(LAT, LNG + lngOffsetForMeters(CALIB_RADIUS_M + 100, LAT), 90);
    const { nearby } = calibrationInputsFor(LAT, LNG, [inside, outside]);
    expect(nearby).toHaveLength(1);
    expect(nearby[0]!.calibratedScore).toBe(60);
  });

  it("returns no inputs when there are no calibrations", () => {
    const { exact, nearby } = calibrationInputsFor(LAT, LNG, []);
    expect(exact).toBeNull();
    expect(nearby).toEqual([]);
  });
});
