import { describe, expect, it } from "vitest";
import {
  CRIME_CATEGORY_WEIGHTS,
  LOCATION_WEIGHTS,
  bucketIncidentCategory,
  locationScore,
  percentileRankCrimeScores,
} from "../location";

describe("locationScore", () => {
  it("applies the documented 30/70 split when both inputs present", () => {
    const got = locationScore({ walkScore: 80, neighborhoodScore: 60 });
    // 0.3 * 80 + 0.7 * 60 = 24 + 42 = 66
    expect(got).toBe(66);
  });

  it("returns walk score alone when neighborhood is missing", () => {
    expect(locationScore({ walkScore: 75, neighborhoodScore: null })).toBe(75);
    expect(locationScore({ walkScore: 75, neighborhoodScore: undefined })).toBe(75);
  });

  it("returns neighborhood score alone when walk score is missing", () => {
    expect(locationScore({ walkScore: null, neighborhoodScore: 40 })).toBe(40);
    expect(locationScore({ walkScore: undefined, neighborhoodScore: 40 })).toBe(40);
  });

  it("returns null when both inputs are missing", () => {
    expect(locationScore({ walkScore: null, neighborhoodScore: null })).toBeNull();
  });

  it("clamps to [0, 100]", () => {
    expect(locationScore({ walkScore: 999, neighborhoodScore: 999 })).toBe(100);
    expect(locationScore({ walkScore: -50, neighborhoodScore: -50 })).toBe(0);
  });

  it("weights sum to 1.0", () => {
    expect(LOCATION_WEIGHTS.walk + LOCATION_WEIGHTS.neighborhood).toBeCloseTo(1, 10);
  });
});

describe("bucketIncidentCategory", () => {
  const cases: Array<[string, "violent" | "property" | "qol" | null]> = [
    ["Assault", "violent"],
    ["Robbery", "violent"],
    ["Homicide", "violent"],
    ["Sex Offense", "violent"],
    ["Rape", "violent"],
    ["Weapons Offense", "violent"],
    ["Human Trafficking, Commercial Sex Acts", "violent"],
    ["Kidnapping", "violent"],

    ["Burglary", "property"],
    ["Larceny Theft", "property"],
    ["Motor Vehicle Theft", "property"],
    ["Arson", "property"],
    ["Stolen Property", "property"],

    ["Drug Offense", "qol"],
    ["Drug Violation", "qol"],
    ["Disorderly Conduct", "qol"],
    ["Vandalism", "qol"],
    ["Malicious Mischief", "qol"],

    ["Non-Criminal", null],
    ["Lost Property", null],
    ["Recovered Vehicle", null],
    ["Suspicious Occ", null],
    ["Case Closure", null],
    ["Warrant", null],
    ["", null],
  ];

  for (const [input, expected] of cases) {
    it(`buckets "${input}" → ${expected}`, () => {
      expect(bucketIncidentCategory(input)).toBe(expected);
    });
  }
});

describe("percentileRankCrimeScores", () => {
  it("orders neighborhoods safest-to-worst without pinning either extreme to 0 or 100", () => {
    const ranks = percentileRankCrimeScores([
      { neighborhood: "Tenderloin", category: "violent", count: 500 },
      { neighborhood: "Tenderloin", category: "property", count: 1000 },
      { neighborhood: "Tenderloin", category: "qol", count: 800 },

      { neighborhood: "Marina", category: "violent", count: 20 },
      { neighborhood: "Marina", category: "property", count: 200 },
      { neighborhood: "Marina", category: "qol", count: 50 },

      { neighborhood: "Seacliff", category: "violent", count: 1 },
      { neighborhood: "Seacliff", category: "property", count: 10 },
      { neighborhood: "Seacliff", category: "qol", count: 2 },
    ]);

    const seacliff = ranks.get("Seacliff")!.crimeScore;
    const marina = ranks.get("Marina")!.crimeScore;
    const tenderloin = ranks.get("Tenderloin")!.crimeScore;

    // Correct ordering, preserved from the old percentile-rank behavior.
    expect(seacliff).toBeGreaterThan(marina);
    expect(marina).toBeGreaterThan(tenderloin);

    // But no hard pin at the extremes — a high-volume outlier neighborhood
    // (like Tenderloin here, or Mission in production) should read as
    // "notably worse than average" rather than a literal floor of 0.
    expect(tenderloin).toBeGreaterThan(0);
    expect(seacliff).toBeLessThan(100);
  });

  it("uses category weights (violent ×3, property ×1, qol ×0.5)", () => {
    expect(CRIME_CATEGORY_WEIGHTS).toEqual({ violent: 3, property: 1, qol: 0.5 });

    const ranks = percentileRankCrimeScores([
      // A: 100 violent → 300 weighted
      { neighborhood: "A", category: "violent", count: 100 },
      // B: 100 property → 100 weighted (lower = safer = higher score)
      { neighborhood: "B", category: "property", count: 100 },
    ]);

    expect(ranks.get("B")!.crimeScore).toBeGreaterThan(ranks.get("A")!.crimeScore);
    expect(ranks.get("A")!.weightedIncidents).toBe(300);
    expect(ranks.get("B")!.weightedIncidents).toBe(100);
  });

  it("is monotonic across many neighborhoods", () => {
    const stats = Array.from({ length: 41 }, (_, i) => ({
      neighborhood: `N${i}`,
      category: "violent" as const,
      count: i * 10,
    }));
    const ranks = percentileRankCrimeScores(stats);

    // N0 has zero crime → top score; N40 has the most → bottom score.
    // Neither hits the literal endpoint — logistic squashing only trends
    // toward 0/100 asymptotically.
    expect(ranks.get("N0")!.crimeScore).toBeGreaterThan(80);
    expect(ranks.get("N0")!.crimeScore).toBeLessThan(100);
    expect(ranks.get("N40")!.crimeScore).toBeGreaterThan(0);
    expect(ranks.get("N40")!.crimeScore).toBeLessThan(20);

    // Strictly monotonic.
    let prev = 100;
    for (let i = 0; i < 41; i++) {
      const s = ranks.get(`N${i}`)!.crimeScore;
      expect(s).toBeLessThanOrEqual(prev);
      prev = s;
    }
  });

  it("handles a single neighborhood with neutral 50", () => {
    const ranks = percentileRankCrimeScores([
      { neighborhood: "OnlyOne", category: "violent", count: 5 },
    ]);
    expect(ranks.get("OnlyOne")?.crimeScore).toBe(50);
  });

  it("returns empty map on empty input", () => {
    expect(percentileRankCrimeScores([]).size).toBe(0);
  });
});
