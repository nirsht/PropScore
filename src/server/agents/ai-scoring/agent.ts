import { z } from "zod";
import { BaseAgent } from "../base/BaseAgent";
import { db } from "@/lib/db";
import { AI_SCORING_SYSTEM_PROMPT, aiScoringUserMessage } from "./prompt";
import { AIScoringInput, AIScoringOutput } from "./schema";

const InternalInput = AIScoringInput.extend({
  listing: z.unknown(),
});

const internal = new BaseAgent({
  name: "ai-scoring",
  systemPrompt: AI_SCORING_SYSTEM_PROMPT,
  inputSchema: InternalInput,
  outputSchema: AIScoringOutput,
  userMessage: (i) => aiScoringUserMessage({ mlsId: i.mlsId, listing: i.listing }),
  tools: [],
  maxSteps: 1,
});

/**
 * Run AI scoring for one mlsId. Persists Score + AIEnrichment.
 * Now consumes the assessor financial values, AI listing-extract output,
 * and ADU read so the model can reason about the new value-add signals.
 */
export async function runAIScoring(mlsId: string, userId: string | null) {
  const listing = await db.listing.findUnique({
    where: { mlsId },
    include: { score: true },
  });
  if (!listing) throw new Error(`Listing not found: ${mlsId}`);

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

  const slim = {
    mlsId: listing.mlsId,
    address: listing.address,
    city: listing.city,
    propertyType: listing.propertyType,
    price: listing.price,
    daysOnMls: listing.daysOnMls,
    beds: listing.beds,
    baths: listing.baths,
    yearBuilt: listing.yearBuilt,

    // MLS-specific
    mlsSqft,
    mlsUnits: listing.units,
    mlsStories: listing.stories,

    // Assessor record
    assessorSqft,
    assessorUnits: listing.assessorUnits,
    assessorStories: listing.assessorStories,
    assessorRooms: listing.assessorRooms,
    assessorBedrooms: listing.assessorBedrooms,
    assessorBuildingValue: buildingValue,
    assessorLandValue: landValue,

    // Derived signals (model-friendly)
    sqftDiscrepancyRatio,
    landValuePct,
    computedRoomsMls,
    pricePerSqft:
      mlsSqft || assessorSqft
        ? listing.price /
          (assessorSqft && assessorSqft > 0 ? assessorSqft : mlsSqft!)
        : null,

    // AI listing-extract
    extractedUnitMix: listing.extractedUnitMix,
    extractedRentRoll: listing.extractedRentRoll,
    extractedTotalMonthlyRent: listing.extractedTotalMonthlyRent,
    extractedOccupancy: listing.extractedOccupancy,
    recentCapex: listing.recentCapex,
    aduPotential: listing.aduPotential,
    aduConfidence: listing.aduConfidence,

    // AI vision
    renovationLevel: listing.renovationLevel,
    renovationConfidence: listing.renovationConfidence,

    occupancy: listing.occupancy,
    publicRemarks: (listing.raw as { PublicRemarks?: string }).PublicRemarks ?? null,
    previousScore: listing.score,
  };

  const result = await internal.run({ input: { mlsId, listing: slim }, userId });

  await db.score.upsert({
    where: { listingMlsId: mlsId },
    create: {
      listingMlsId: mlsId,
      densityScore: result.output.densityScore,
      vacancyScore: result.output.vacancyScore,
      motivationScore: result.output.motivationScore,
      valueAddWeightedAvg: result.output.valueAddWeightedAvg,
      breakdown: { rationale: result.output.rationale, signals: result.output.signals },
      computedBy: "AI",
    },
    update: {
      densityScore: result.output.densityScore,
      vacancyScore: result.output.vacancyScore,
      motivationScore: result.output.motivationScore,
      valueAddWeightedAvg: result.output.valueAddWeightedAvg,
      breakdown: { rationale: result.output.rationale, signals: result.output.signals },
      computedBy: "AI",
      computedAt: new Date(),
    },
  });

  await db.aIEnrichment.create({
    data: {
      listingMlsId: mlsId,
      agentName: "ai-scoring",
      output: result.output,
    },
  });

  return result.output;
}
