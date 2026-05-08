import { z } from "zod";
import { defineTool } from "../base/tools";
import { db } from "@/lib/db";
import { getByBlockLot, searchByAddress } from "@/server/etl/sfpim-client";

/**
 * fetch_parcel — Live SF Assessor parcel lookup via Socrata. The Listing
 * row already carries assessor data from the nightly enrichment, so prefer
 * the stored values; this tool re-pulls when the user asks about something
 * the stored snapshot doesn't have, or wants to confirm a value.
 *
 * Looks up by APN (block-lot) when known, falls back to the listing address.
 */
export const fetchParcelTool = defineTool({
  name: "fetch_parcel",
  description:
    "Look up the live SF Assessor parcel record (building/lot sqft, year built, units, rooms, assessed building+land value, use type). Use only when the question is parcel-specific (zoning, assessed values, official sqft) and the stored values aren't enough.",
  input: z.object({
    mlsId: z.string().describe("The listing whose parcel to look up."),
  }),
  run: async ({ mlsId }) => {
    const listing = await db.listing.findUnique({
      where: { mlsId },
      select: { mlsId: true, address: true, blockLot: true },
    });
    if (!listing) throw new Error(`Listing not found: ${mlsId}`);

    if (listing.blockLot) {
      const byApn = await getByBlockLot(listing.blockLot);
      if (byApn) return { source: "blockLot", record: byApn };
    }
    const byAddress = await searchByAddress(listing.address);
    if (byAddress) return { source: "address", record: byAddress };
    return { source: "none", record: null };
  },
});
