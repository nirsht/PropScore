/**
 * Recompute the heuristic Score row and calibrated location score for a single
 * listing. Extracted from scripts/recompute-scores.ts so the nightly sweep and
 * the calibration API mutation share one code path — a calibration applied via
 * the UI produces exactly the same numbers the next nightly run would.
 *
 * Applies user calibrations to the base location score (blendCalibration)
 * before persisting, so the calibrated value flows through to both
 * Listing.locationScore and Score.locationScore / valueAddWeightedAvg.
 */
import type { Prisma } from "@prisma/client";
import type { db } from "@/lib/db";
import { normalizeListing } from "@/server/etl/normalize";
import { computeHeuristicScore } from "@/server/etl/scoring";
import { blendCalibration, locationScore } from "@/server/etl/scoring/location";
import {
  calibrationInputsFor,
  type LoadedCalibration,
} from "@/server/etl/scoring/calibration";

type Db = typeof db;

export type ListingForRecompute = Prisma.ListingGetPayload<{
  include: { score: true; neighborhoodRel: true };
}>;

export type RecomputeDelta = {
  updatedListing: boolean;
  locationUpdated: boolean;
  scored: boolean;
};

export async function recomputeListingScore(
  db: Db,
  l: ListingForRecompute,
  calibrations: ReadonlyArray<LoadedCalibration>,
): Promise<RecomputeDelta> {
  const delta: RecomputeDelta = {
    updatedListing: false,
    locationUpdated: false,
    scored: false,
  };
  const raw = l.raw as Record<string, unknown>;
  const norm = normalizeListing(raw);
  if (!norm) return delta;

  // Re-persist normalized fields if they changed (specifically to flip 0 → null)
  const fieldsChanged =
    l.sqft !== norm.sqft ||
    l.units !== norm.units ||
    l.beds !== norm.beds ||
    l.baths !== norm.baths ||
    l.yearBuilt !== norm.yearBuilt ||
    l.stories !== norm.stories;

  if (fieldsChanged) {
    await db.listing.update({
      where: { mlsId: l.mlsId },
      data: {
        sqft: norm.sqft,
        units: norm.units,
        beds: norm.beds,
        baths: norm.baths,
        yearBuilt: norm.yearBuilt,
        stories: norm.stories,
      },
    });
    delta.updatedListing = true;
  }

  // Location score is independent of AI value-add scoring — always recompute
  // when either of its inputs is present, even when we skip the heuristic
  // Score row below. The base (walk + safety) score is then folded through any
  // user calibrations: an exact override at this address, or a distance-decaying
  // nudge from nearby calibrations.
  const baseLocation = locationScore({
    walkScore: l.walkScore,
    neighborhoodScore: l.neighborhoodRel?.crimeScore ?? null,
  });
  const { exact, nearby } =
    l.lat != null && l.lng != null
      ? calibrationInputsFor(l.lat, l.lng, calibrations)
      : { exact: null, nearby: [] };
  const newLocation = blendCalibration({ baseScore: baseLocation, exact, nearby });

  if (newLocation !== l.locationScore) {
    await db.listing.update({
      where: { mlsId: l.mlsId },
      data: {
        locationScore: newLocation,
        locationScoreUpdatedAt: new Date(),
      },
    });
    delta.locationUpdated = true;
  }

  const um = l.extractedUnitMix as Array<{ count?: number }> | null;
  const extractedUnitsTotal =
    Array.isArray(um) && um.length
      ? um.reduce((sum, e) => sum + (e.count ?? 0), 0) || null
      : null;

  const assessedValueTotal =
    (l.assessorBuildingValue ?? 0) + (l.assessorLandValue ?? 0) || null;

  const s = computeHeuristicScore(norm, {
    effectiveSqft: l.assessorBuildingSqft ?? l.sqft,
    effectiveUnits: l.assessorUnits ?? l.units ?? extractedUnitsTotal,
    effectiveStories: l.assessorStories ?? l.stories ?? l.aiStories,
    renovationLevel: l.renovationLevel,
    renovationConfidence: l.renovationConfidence,
    mlsSqft: l.sqft,
    assessorSqft: l.assessorBuildingSqft,
    assessorBuildingValue: l.assessorBuildingValue,
    assessorLandValue: l.assessorLandValue,
    assessedValueTotal,
    extractedOccupancy: l.extractedOccupancy,
    extractedUnitsTotal,
    extractedTotalMonthlyRent: l.extractedTotalMonthlyRent,
    extractedMarketMonthlyRent: l.extractedMarketMonthlyRent,
    detachedAduScore: l.detachedAduScore,
    convertedAduScore: l.convertedAduScore,
    locationScore: newLocation,
    assessorConstructionType: l.assessorConstructionType,
    landUseCategory: l.landUseCategory,
    permitsOwnParcelAduCount: l.permitsOwnParcelAduCount,
    permitsBlockAduRecentCount: l.permitsBlockAduRecentCount,
    permitsRadiusAduRecentCount: l.permitsRadiusAduRecentCount,
    codeViolationsOpenCount: l.codeViolationsOpenCount,
    codeViolationsRecentCount: l.codeViolationsRecentCount,
    housingNetUnitChange5y: l.housingNetUnitChange5y,
    rentControlCovered: l.rentControlCovered,
    neighborhoodMedianAssessedPerSqft:
      l.neighborhoodRel?.medianAssessedPerSqft ?? null,
    neighborhoodMedianAssessedPerUnit:
      l.neighborhoodRel?.medianAssessedPerUnit ?? null,
    neighborhoodCompSampleSize: l.neighborhoodRel?.compSampleSize ?? null,
    zoningMaxUnits: l.zoningMaxUnits,
  });
  await db.score.upsert({
    where: { listingMlsId: l.mlsId },
    create: {
      listingMlsId: l.mlsId,
      densityScore: s.densityScore,
      vacancyScore: s.vacancyScore,
      motivationScore: s.motivationScore,
      locationScore: s.locationScore,
      aduScore: s.aduScore,
      rehabScore: s.rehabScore,
      assessmentDeltaScore: s.assessmentDeltaScore,
      zoningUpsideScore: s.zoningUpsideScore,
      marketUpsideScore: s.marketUpsideScore,
      valueAddWeightedAvg: s.valueAddWeightedAvg,
      breakdown: s.breakdown as Prisma.InputJsonValue,
      computedBy: "HEURISTIC",
    },
    update: {
      densityScore: s.densityScore,
      vacancyScore: s.vacancyScore,
      motivationScore: s.motivationScore,
      locationScore: s.locationScore,
      aduScore: s.aduScore,
      rehabScore: s.rehabScore,
      assessmentDeltaScore: s.assessmentDeltaScore,
      zoningUpsideScore: s.zoningUpsideScore,
      marketUpsideScore: s.marketUpsideScore,
      valueAddWeightedAvg: s.valueAddWeightedAvg,
      breakdown: s.breakdown as Prisma.InputJsonValue,
      computedBy: "HEURISTIC",
      computedAt: new Date(),
    },
  });
  delta.scored = true;
  return delta;
}
