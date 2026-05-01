import { describe, expect, it } from "vitest";
import {
  getDiscrepancyTone,
  isDiverging,
  resolvePreferred,
  rowDiverges,
} from "../diff";

describe("isDiverging", () => {
  it("returns false when either side is null/undefined", () => {
    expect(isDiverging(null, 100)).toBe(false);
    expect(isDiverging(100, null)).toBe(false);
    expect(isDiverging(undefined, undefined)).toBe(false);
  });
  it("returns false when values agree within threshold", () => {
    expect(isDiverging(1000, 1040)).toBe(false);
    expect(isDiverging(1000, 1050)).toBe(false);
  });
  it("returns true when values differ beyond 5%", () => {
    expect(isDiverging(1000, 1100)).toBe(true);
    expect(isDiverging(1000, 800)).toBe(true);
  });
});

describe("getDiscrepancyTone", () => {
  it("neutral when no divergence", () => {
    expect(getDiscrepancyTone(1000, 1020)).toBe("neutral");
    expect(getDiscrepancyTone(null, 1000)).toBe("neutral");
  });
  it("positive when assessor > mls", () => {
    expect(getDiscrepancyTone(1000, 1200)).toBe("positive");
  });
  it("negative when assessor < mls", () => {
    expect(getDiscrepancyTone(1200, 1000)).toBe("negative");
  });
});

describe("resolvePreferred", () => {
  it("prefers assessor by default", () => {
    expect(resolvePreferred({ assessor: 100, mls: 200 })).toEqual({
      value: 100,
      source: "assessor",
    });
  });
  it("falls back to mls when assessor missing", () => {
    expect(resolvePreferred({ mls: 200 })).toEqual({ value: 200, source: "mls" });
  });
  it("falls back to ai last", () => {
    expect(resolvePreferred({ ai: 3 })).toEqual({ value: 3, source: "ai" });
  });
  it("returns null when nothing populated", () => {
    expect(resolvePreferred<number>({})).toEqual({ value: null, source: null });
  });
  it("treats zero as null", () => {
    expect(resolvePreferred({ assessor: 0, mls: 100 })).toEqual({
      value: 100,
      source: "mls",
    });
  });
  it("supports custom priority order", () => {
    const out = resolvePreferred({ mls: 1, assessor: 2, ai: 3 }, ["ai", "mls", "assessor"]);
    expect(out).toEqual({ value: 3, source: "ai" });
  });
});

describe("rowDiverges", () => {
  it("flags any pair beyond threshold", () => {
    expect(rowDiverges([1000, 1020, 1500])).toBe(true);
    expect(rowDiverges([1000, 1020, 1040])).toBe(false);
    expect(rowDiverges([1000, null, 1500])).toBe(true);
    expect(rowDiverges([null, null])).toBe(false);
  });
});
