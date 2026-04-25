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
 */
export async function runAIScoring(mlsId: string, userId: string | null) {
  const listing = await db.listing.findUnique({
    where: { mlsId },
    include: { score: true },
  });
  if (!listing) throw new Error(`Listing not found: ${mlsId}`);

  const slim = {
    mlsId: listing.mlsId,
    address: listing.address,
    city: listing.city,
    propertyType: listing.propertyType,
    price: listing.price,
    sqft: listing.sqft,
    units: listing.units,
    beds: listing.beds,
    baths: listing.baths,
    yearBuilt: listing.yearBuilt,
    daysOnMls: listing.daysOnMls,
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
