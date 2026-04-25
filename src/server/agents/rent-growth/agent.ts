import { z } from "zod";
import { BaseAgent } from "../base/BaseAgent";
import { db } from "@/lib/db";
import { RENT_GROWTH_SYSTEM_PROMPT, rentGrowthUserMessage } from "./prompt";
import { RentGrowthInput, RentGrowthOutput } from "./schema";

const InternalInput = RentGrowthInput.extend({
  listing: z.unknown(),
});

const internal = new BaseAgent({
  name: "rent-growth",
  systemPrompt: RENT_GROWTH_SYSTEM_PROMPT,
  inputSchema: InternalInput,
  outputSchema: RentGrowthOutput,
  userMessage: (i) => rentGrowthUserMessage({ mlsId: i.mlsId, listing: i.listing }),
  tools: [],
  maxSteps: 1,
});

/**
 * Run rent-growth estimation. Persists to AIEnrichment so the drawer can
 * read the most recent estimate without re-running the agent.
 */
export async function runRentGrowth(mlsId: string, userId: string | null) {
  const listing = await db.listing.findUnique({ where: { mlsId } });
  if (!listing) throw new Error(`Listing not found: ${mlsId}`);

  const slim = {
    mlsId: listing.mlsId,
    address: listing.address,
    city: listing.city,
    state: listing.state,
    postalCode: listing.postalCode,
    propertyType: listing.propertyType,
    price: listing.price,
    sqft: listing.sqft,
    units: listing.units,
    beds: listing.beds,
    baths: listing.baths,
    yearBuilt: listing.yearBuilt,
    publicRemarks: (listing.raw as { PublicRemarks?: string }).PublicRemarks ?? null,
  };

  const result = await internal.run({ input: { mlsId, listing: slim }, userId });

  await db.aIEnrichment.create({
    data: {
      listingMlsId: mlsId,
      agentName: "rent-growth",
      output: result.output,
    },
  });

  return result.output;
}
