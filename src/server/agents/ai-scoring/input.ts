import { createHash } from "node:crypto";
import type { Listing, Score } from "@prisma/client";

export type AIScoringListing = Listing & { score: Score | null };

export type AIScoringSlim = {
  mlsId: string;
  address: string | null;
  city: string | null;
  propertyType: string | null;
  price: number | null;
  daysOnMls: number | null;
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
  aduPotential: string | null;
  aduConfidence: number | null;
  renovationLevel: string | null;
  renovationConfidence: number | null;
  occupancy: number | null;
  publicRemarks: string | null;
  previousScore: unknown;
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

  return {
    mlsId: listing.mlsId,
    address: listing.address,
    city: listing.city,
    propertyType: listing.propertyType,
    price: listing.price,
    daysOnMls: listing.daysOnMls,
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
    aduPotential: listing.aduPotential,
    aduConfidence: listing.aduConfidence,
    renovationLevel: listing.renovationLevel,
    renovationConfidence: listing.renovationConfidence,
    occupancy: listing.occupancy,
    publicRemarks,
    previousScore: listing.score,
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
 * Stable sha256 of the slim payload — used as `Score.aiInputHash`. Drop
 * `previousScore` from the hash since it reflects the agent's own prior
 * write and would force a re-score every time the agent runs.
 */
export function hashAIScoringInput(slim: AIScoringSlim): string {
  const { previousScore: _previousScore, ...rest } = slim;
  return createHash("sha256").update(stableStringify(rest)).digest("hex");
}
