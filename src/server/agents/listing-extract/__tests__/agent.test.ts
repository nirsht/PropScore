import { describe, expect, it } from "vitest";
import {
  deriveAttachedAduFromHeuristic,
  deriveDetachedAduFromHeuristic,
  deriveConvertedAduFromHeuristic,
} from "../agent";
import { ListingExtractOutput } from "../schema";

describe("deriveDetachedAduFromHeuristic", () => {
  it("returns null score when lot is unknown", () => {
    expect(
      deriveDetachedAduFromHeuristic({
        units: 1,
        buildingSqft: 1500,
        lotSqft: null,
        stories: 2,
      }).score,
    ).toBeNull();
  });

  it("scores high on a generous lot", () => {
    const out = deriveDetachedAduFromHeuristic({
      units: 1,
      buildingSqft: 1500,
      lotSqft: 4000,
      stories: 2,
    });
    expect(out.score).toBeGreaterThanOrEqual(80);
  });

  it("floors to 0 for dense large multifamily", () => {
    expect(
      deriveDetachedAduFromHeuristic({
        units: 12,
        buildingSqft: 12000,
        lotSqft: 5000,
        stories: 3,
      }).score,
    ).toBe(0);
  });

  it("scores in the medium band for tight-but-plausible yards", () => {
    const out = deriveDetachedAduFromHeuristic({
      units: 3,
      buildingSqft: 2000,
      lotSqft: 2500,
      stories: 2,
    });
    expect(out.score).toBeGreaterThan(20);
    expect(out.score).toBeLessThan(80);
  });

  it("zeros out when the building covers the full lot depth", () => {
    // 2,000 sqft lot, 4,500 sqft 2-story building → footprint ≈ 2,250 sqft,
    // building depth exceeds lot depth ⇒ no rear yard.
    const out = deriveDetachedAduFromHeuristic({
      units: 1,
      buildingSqft: 4500,
      lotSqft: 2000,
      stories: 2,
    });
    expect(out.score).toBe(0);
  });

  it("applies side setbacks — a tall SF townhouse no longer scores top band", () => {
    // The old residual-area heuristic would call this ~100 (1,333 sqft
    // "unused" of a 2,500 sqft lot). The new rear-yard math accounts for
    // the building spanning the full lot width and 4 ft side setbacks,
    // so the score lands in the mid-band.
    const out = deriveDetachedAduFromHeuristic({
      units: 2,
      buildingSqft: 3500,
      lotSqft: 2500,
      stories: 3,
    });
    expect(out.score).toBeGreaterThan(40);
    expect(out.score).toBeLessThan(85);
  });
});

describe("deriveAttachedAduFromHeuristic", () => {
  it("returns null score when lot is unknown", () => {
    expect(
      deriveAttachedAduFromHeuristic({
        units: 1,
        buildingSqft: 1500,
        lotSqft: null,
        stories: 2,
      }).score,
    ).toBeNull();
  });

  it("scores high on a generous lot — no separation buffer needed", () => {
    const out = deriveAttachedAduFromHeuristic({
      units: 1,
      buildingSqft: 1500,
      lotSqft: 4000,
      stories: 2,
    });
    expect(out.score).toBeGreaterThanOrEqual(80);
  });

  it("zeros out when the building leaves no rear envelope after rear setback", () => {
    const out = deriveAttachedAduFromHeuristic({
      units: 1,
      buildingSqft: 4500,
      lotSqft: 2000,
      stories: 2,
    });
    expect(out.score).toBe(0);
  });

  it("scores attached slightly higher than detached on the same tight lot", () => {
    // No 6 ft separation buffer means the attached envelope is at least as
    // generous as the detached one; the looser score ladder usually pushes it
    // a touch higher in the mid-band.
    const input = {
      units: 2,
      buildingSqft: 3000,
      lotSqft: 3000,
      stories: 2,
    };
    const detached = deriveDetachedAduFromHeuristic(input).score ?? 0;
    const attached = deriveAttachedAduFromHeuristic(input).score ?? 0;
    expect(attached).toBeGreaterThanOrEqual(detached);
  });

  it("floors to 0 for dense large multifamily", () => {
    expect(
      deriveAttachedAduFromHeuristic({
        units: 12,
        buildingSqft: 12000,
        lotSqft: 5000,
        stories: 3,
      }).score,
    ).toBe(0);
  });
});

describe("deriveConvertedAduFromHeuristic", () => {
  it("returns null when no signals", () => {
    expect(
      deriveConvertedAduFromHeuristic({
        basementSqft: null,
        aiHasBasement: null,
      }).score,
    ).toBeNull();
  });

  it("scores 80 for a 500+ sqft assessor basement", () => {
    expect(
      deriveConvertedAduFromHeuristic({
        basementSqft: 700,
        aiHasBasement: null,
      }),
    ).toMatchObject({ score: 80, source: "basement" });
  });

  it("scores 55 for a 300–499 sqft basement", () => {
    expect(
      deriveConvertedAduFromHeuristic({
        basementSqft: 350,
        aiHasBasement: null,
      }).score,
    ).toBe(55);
  });

  it("scores 50 with vision-only basement signal", () => {
    expect(
      deriveConvertedAduFromHeuristic({
        basementSqft: null,
        aiHasBasement: true,
      }).score,
    ).toBe(50);
  });
});

describe("ListingExtractOutput schema", () => {
  it("accepts a tabular rent roll", () => {
    const sample = {
      unitMix: null,
      unitMixEvidence: null,
      rentRoll: [
        { rent: 1284, beds: 3, baths: 2 },
        { rent: 1500, beds: 3, baths: 2 },
        { rent: 3100, beds: 3, baths: 2 },
        { rent: 7850, beds: 4, baths: 3 },
      ],
      aiRentEstimate: null,
      postRenovationRentEstimate: null,
      totalMonthlyRent: 13734,
      occupancy: null,
      recentCapex: null,
      parkingNotes: null,
      basementNotes: null,
      viewNotes: null,
      detachedAduScore: 55,
      detachedAduRationale: "ok",
      attachedAduScore: 60,
      attachedAduRationale: "rear addition possible",
      convertedAduScore: 70,
      convertedAduRationale: "huge basement",
      convertedAduSource: "basement" as const,
      rationale: "parsed",
    };
    expect(() => ListingExtractOutput.parse(sample)).not.toThrow();
  });

  it("accepts a unit-mix narrative", () => {
    const sample = {
      unitMix: [
        { count: 1, beds: 2, baths: 1 },
        { count: 2, beds: 2, baths: 2 },
        { count: 4, beds: 3, baths: 2 },
        { count: 2, beds: 4, baths: 2 },
      ],
      unitMixEvidence: {
        sourceQuote: "one 2bd-1ba, two 2bd-2ba, four 3bd-2ba, and two 4bd-2ba",
        sourceField: "publicRemarks" as const,
      },
      rentRoll: null,
      aiRentEstimate: null,
      postRenovationRentEstimate: null,
      totalMonthlyRent: null,
      occupancy: null,
      recentCapex: null,
      parkingNotes: null,
      basementNotes: null,
      viewNotes: null,
      detachedAduScore: null,
      detachedAduRationale: "",
      attachedAduScore: null,
      attachedAduRationale: "",
      convertedAduScore: null,
      convertedAduRationale: "",
      convertedAduSource: null,
      rationale: "parsed",
    };
    expect(() => ListingExtractOutput.parse(sample)).not.toThrow();
  });

  it("accepts unit-mix entries with null beds/baths", () => {
    // Real-world: "8 unit building" with no per-unit detail.
    const sample = {
      unitMix: [
        { count: 8, beds: null, baths: null },
        { count: 1, beds: 2, baths: null },
      ],
      unitMixEvidence: {
        sourceQuote: "8 unit building",
        sourceField: "publicRemarks" as const,
      },
      rentRoll: null,
      aiRentEstimate: null,
      postRenovationRentEstimate: null,
      totalMonthlyRent: null,
      occupancy: null,
      recentCapex: null,
      parkingNotes: null,
      basementNotes: null,
      viewNotes: null,
      detachedAduScore: null,
      detachedAduRationale: "",
      attachedAduScore: null,
      attachedAduRationale: "",
      convertedAduScore: null,
      convertedAduRationale: "",
      convertedAduSource: null,
      rationale: "parsed",
    };
    expect(() => ListingExtractOutput.parse(sample)).not.toThrow();
  });
});
