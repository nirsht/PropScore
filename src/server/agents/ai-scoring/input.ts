import { createHash } from "node:crypto";
import type { Listing, Score } from "@prisma/client";
import {
  VALUE_ADD_WEIGHTS,
  weightedValueAdd,
  type WeightedComponents,
} from "@/server/etl/scoring/valueAdd";

export type AIScoringListing = Listing & { score: Score | null };

/**
 * Bump when the scoring prompt or its input contract changes in a way that
 * should invalidate every cached `Score.aiInputHash` and trigger a one-shot
 * full re-score on the next nightly. It's the ONE field allowed to churn the
 * hash without a raw-data change.
 *   v2 — anchor `valueAddWeightedAvg` to the weighted `baselineValueAdd`
 *        instead of free-scoring the composite (2026-07-18).
 */
export const AI_SCORING_INPUT_VERSION = 2;

export type AIScoringSlim = {
  /** Scoring-contract version — participates in the hash so a bump re-scores all. */
  scoringVersion: number;
  mlsId: string;
  address: string | null;
  city: string | null;
  propertyType: string | null;
  price: number | null;
  /** Bridge's stored DaysOnMarket snapshot. Often null/stale; prefer postDate-derived age. */
  daysOnMls: number | null;
  /** Date the listing was posted. Use this to compute live DOM at scoring time. */
  postDate: Date | null;
  beds: number | null;
  baths: number | null;
  yearBuilt: number | null;
  mlsSqft: number | null;
  mlsUnits: number | null;
  mlsStories: number | null;
  assessorSqft: number | null;
  assessorUnits: number | null;
  assessorStories: number | null;
  assessorRooms: number | null;
  assessorBedrooms: number | null;
  assessorBuildingValue: number | null;
  assessorLandValue: number | null;
  sqftDiscrepancyRatio: number | null;
  landValuePct: number | null;
  computedRoomsMls: number | null;
  pricePerSqft: number | null;
  extractedUnitMix: unknown;
  extractedRentRoll: unknown;
  extractedTotalMonthlyRent: number | null;
  extractedOccupancy: number | null;
  recentCapex: unknown;
  detachedAduScore: number | null;
  attachedAduScore: number | null;
  convertedAduScore: number | null;
  convertedAduSource: string | null;
  renovationLevel: string | null;
  renovationConfidence: number | null;
  occupancy: number | null;
  publicRemarks: string | null;
  previousScore: unknown;
  /** The canonical component weights the composite must respect. */
  valueAddWeights: typeof VALUE_ADD_WEIGHTS;
  /**
   * Current per-component heuristic scores. The AI re-scores density /
   * vacancy / motivation; location / rehab / adu have no AI counterpart and
   * are carried through unchanged into the composite baseline.
   */
  heuristicComponents: WeightedComponents;
  /**
   * Weighted average of `heuristicComponents` under `valueAddWeights` — the
   * default the AI anchors its `valueAddWeightedAvg` to (after substituting
   * its own density / vacancy / motivation reads). Null before any heuristic
   * score exists.
   */
  baselineValueAdd: number | null;
};

/**
 * Build the slim listing payload sent to the AI scoring agent. Single
 * source of truth shared by the agent (per-listing on-demand) and the
 * nightly delta driver (hash-then-decide). Bumping any field here
 * invalidates every cached `Score.aiInputHash` and triggers a one-shot
 * full re-score on the next nightly.
 */
export function buildAIScoringInput(listing: AIScoringListing): AIScoringSlim {
  const mlsSqft = listing.sqft;
  const assessorSqft = listing.assessorBuildingSqft;
  const sqftDiscrepancyRatio =
    mlsSqft && mlsSqft > 0 && assessorSqft && assessorSqft > 0
      ? assessorSqft / mlsSqft
      : null;
  const landValue = listing.assessorLandValue;
  const buildingValue = listing.assessorBuildingValue;
  const landTotal = (landValue ?? 0) + (buildingValue ?? 0);
  const landValuePct = landTotal > 0 && landValue != null ? landValue / landTotal : null;
  const computedRoomsMls =
    listing.beds != null && listing.units != null
      ? listing.beds + listing.units * 2
      : null;
  const pricePerSqft =
    mlsSqft || assessorSqft
      ? listing.price /
        (assessorSqft && assessorSqft > 0 ? assessorSqft : mlsSqft!)
      : null;
  const publicRemarks =
    (listing.raw as { PublicRemarks?: string } | null)?.PublicRemarks ?? null;

  const s = listing.score;
  const heuristicComponents: WeightedComponents = {
    vacancyScore: s?.vacancyScore ?? null,
    locationScore: s?.locationScore ?? null,
    densityScore: s?.densityScore ?? null,
    rehabScore: s?.rehabScore ?? null,
    aduScore: s?.aduScore ?? null,
    motivationScore: s?.motivationScore ?? null,
  };
  const hasAnyComponent = Object.values(heuristicComponents).some((v) => v != null);
  const baselineValueAdd = hasAnyComponent
    ? Math.round(weightedValueAdd(heuristicComponents) * 10) / 10
    : null;

  return {
    scoringVersion: AI_SCORING_INPUT_VERSION,
    mlsId: listing.mlsId,
    address: listing.address,
    city: listing.city,
    propertyType: listing.propertyType,
    price: listing.price,
    // Pass Bridge's stored snapshot (nullable — 0 is treated as missing
    // in normalize.ts) plus postDate; the AI agent computes the actual
    // DOM band from postDate. Putting `Date.now()` here would churn the
    // hash daily and force unnecessary re-scoring.
    daysOnMls: listing.daysOnMls,
    postDate: listing.postDate ?? null,
    beds: listing.beds,
    baths: listing.baths,
    yearBuilt: listing.yearBuilt,
    mlsSqft,
    mlsUnits: listing.units,
    mlsStories: listing.stories,
    assessorSqft,
    assessorUnits: listing.assessorUnits,
    assessorStories: listing.assessorStories,
    assessorRooms: listing.assessorRooms,
    assessorBedrooms: listing.assessorBedrooms,
    assessorBuildingValue: buildingValue,
    assessorLandValue: landValue,
    sqftDiscrepancyRatio,
    landValuePct,
    computedRoomsMls,
    pricePerSqft,
    extractedUnitMix: listing.extractedUnitMix,
    extractedRentRoll: listing.extractedRentRoll,
    extractedTotalMonthlyRent: listing.extractedTotalMonthlyRent,
    extractedOccupancy: listing.extractedOccupancy,
    recentCapex: listing.recentCapex,
    detachedAduScore: listing.detachedAduScore,
    attachedAduScore: listing.attachedAduScore,
    convertedAduScore: listing.convertedAduScore,
    convertedAduSource: listing.convertedAduSource,
    renovationLevel: listing.renovationLevel,
    renovationConfidence: listing.renovationConfidence,
    occupancy: listing.occupancy,
    publicRemarks,
    previousScore: listing.score,
    valueAddWeights: VALUE_ADD_WEIGHTS,
    heuristicComponents,
    baselineValueAdd,
  };
}

/**
 * Stable-key JSON stringify (recursive). Object keys are sorted so that
 * field-reordering at the source doesn't change the hash; array order is
 * preserved (it's semantic for unit mix / rent roll).
 */
function stableStringify(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  const obj = value as Record<string, unknown>;
  const keys = Object.keys(obj).sort();
  return `{${keys.map((k) => `${JSON.stringify(k)}:${stableStringify(obj[k])}`).join(",")}}`;
}

/**
 * Stable sha256 of the slim payload — used as `Score.aiInputHash`. Drop the
 * heuristic-derived fields (`previousScore`, `heuristicComponents`,
 * `baselineValueAdd`, and the constant `valueAddWeights`) from the hash:
 * they reflect the nightly heuristic recompute / the agent's own prior write
 * and would force a re-score on every heuristic drift. The underlying raw
 * inputs (occupancy, remarks, ADU reads, …) already capture every change
 * that should trigger a fresh AI score.
 */
export function hashAIScoringInput(slim: AIScoringSlim): string {
  const {
    previousScore: _previousScore,
    heuristicComponents: _heuristicComponents,
    baselineValueAdd: _baselineValueAdd,
    valueAddWeights: _valueAddWeights,
    ...rest
  } = slim;
  return createHash("sha256").update(stableStringify(rest)).digest("hex");
}
