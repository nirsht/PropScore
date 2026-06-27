import type { RenovationLevel } from "@prisma/client";

export type ScoreLike = {
  densityScore: number;
  vacancyScore: number;
  motivationScore: number;
  locationScore?: number | null;
  rehabScore?: number | null;
  aduScore?: number | null;
  marketUpsideScore?: number | null;
  assessmentDeltaScore?: number | null;
  zoningUpsideScore?: number | null;
  valueAddWeightedAvg: number;
  computedBy?: "HEURISTIC" | "AI";
  aiDensityScore?: number | null;
  aiVacancyScore?: number | null;
  aiMotivationScore?: number | null;
  aiValueAddWeightedAvg?: number | null;
  aiBreakdown?: unknown;
};

export type ListingForDetails = {
  // MLS-side
  sqft: number | null;
  lotSizeSqft: number | null;
  units: number | null;
  beds: number | null;
  baths: number | null;
  yearBuilt: number | null;
  stories: number | null;
  price: number;
  // Assessor-side
  assessorBuildingSqft: number | null;
  assessorLotSqft: number | null;
  assessorUnits: number | null;
  assessorBedrooms: number | null;
  assessorBathrooms: number | null;
  assessorYearBuilt: number | null;
  assessorStories: number | null;
  assessorRooms: number | null;
  assessorBuildingValue: number | null;
  assessorLandValue: number | null;
  assessorFetchedAt: Date | string | null;
  // AI-side
  aiStories: number | null;
  extractedUnitMix: unknown;
  enrichments?: Array<{
    id: string;
    agentName: string;
    output: unknown;
    createdAt: Date | string;
  }>;
};

export type ListingForAI = {
  mlsId: string;
  lat: number | null;
  lng: number | null;
  aiStories: number | null;
  aiHasBasement: boolean | null;
  aiHasPenthouse: boolean | null;
  aiBestPhotoUrl: string | null;
  renovationLevel: RenovationLevel | null;
  renovationConfidence: number | null;
  visionFetchedAt: Date | string | null;
  extractedUnitMix: unknown;
  extractedRentRoll: unknown;
  aiRentEstimate: unknown;
  postRenovationRentEstimate: unknown;
  extractedTotalMonthlyRent: number | null;
  extractedOccupancy: number | null;
  recentCapex: unknown;
  detachedAduScore: number | null;
  detachedAduRationale: string | null;
  attachedAduScore: number | null;
  attachedAduRationale: string | null;
  convertedAduScore: number | null;
  convertedAduRationale: string | null;
  convertedAduSource: string | null;
  extractFetchedAt: Date | string | null;
  /** "ai_extraction" | "email_reply" | null — drives the source badge in
   *  RentRollSection so the user knows whether numbers came from MLS remarks
   *  or an actual agent rent roll. */
  extractedRentRollSource: string | null;
  privateRemarks: string | null;
};

export type RentRollEntryUI = {
  // null = vacant unit. Row stays so totals/UI can render the unit and a
  // market/proforma estimate even when there's no current rent.
  rent: number | null;
  beds: number | null;
  baths: number | null;
  sqft?: number | null;
  unitLabel?: string | null;
  moveInDate?: string | null;
};

export type UnitMixEntryUI = {
  count: number;
  beds: number | null;
  baths: number | null;
};

export type RentEstimateEntryUI = {
  beds: number | null;
  baths: number | null;
  estimatedRent: number;
  rationale: string;
  sqft?: number | null;
  unitLabel?: string | null;
  source?: "gpt" | "comps";
};

export type RentCompBucketUI = {
  beds: number | null;
  baths: number | null;
  count: number;
  medianRent: number | null;
  medianPricePerSqft: number | null;
  medianSqft: number | null;
};

export type RentCompsOutputUI = {
  totalComps: number;
  radiusMiles: number;
  monthsBack: number;
  buckets: RentCompBucketUI[];
  summary: string;
};
