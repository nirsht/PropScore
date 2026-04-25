import { z } from "zod";
import { defineTool } from "../base/tools";
import { searchListings } from "@/server/api/listings-search";
import { FilterInput } from "@/server/api/schemas/filter";

export const searchListingsTool = defineTool({
  name: "search_listings",
  description:
    "Run the same indexed listings search the UI uses. Returns up to 50 rows. Useful for grounding answers in real data before reasoning over a result set.",
  input: FilterInput,
  run: async (input) => {
    const result = await searchListings(input);
    return {
      rows: result.rows.slice(0, 50),
      nextCursor: result.nextCursor,
    };
  },
});

export const getListingTool = defineTool({
  name: "get_listing",
  description: "Fetch one listing by mlsId, including its score and AI enrichments.",
  input: z.object({ mlsId: z.string() }),
  run: async ({ mlsId }) => {
    const { db } = await import("@/lib/db");
    return db.listing.findUnique({
      where: { mlsId },
      include: { score: true, enrichments: { orderBy: { createdAt: "desc" }, take: 3 } },
    });
  },
});
