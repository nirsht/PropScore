import { z } from "zod";
import { defineTool } from "../base/tools";
import { runRentComps } from "../rent-comps/agent";

/**
 * fetch_rent_comps — wraps the existing rent-comps agent. Pulls SFAR closed
 * leases within a radius/recency window of the given listing, buckets them
 * by (beds, baths), and returns the aggregate. Persists to AIEnrichment as
 * a side effect so the listing drawer can render the same data later.
 *
 * Cheap, deterministic — no LLM call inside.
 */
export const fetchRentCompsTool = defineTool({
  name: "fetch_rent_comps",
  description:
    "Pull SFAR closed-lease comps within a radius of the listing (default 1mi, last 24mo). Use this to ground rent estimates, compare a listing's asking rents to market, or answer 'what do similar units rent for nearby?'. Updates the listing's stored rent-comp data as a side effect.",
  input: z.object({
    mlsId: z.string(),
    radiusMiles: z.number().min(0.1).max(5).optional(),
    monthsBack: z.number().int().min(3).max(48).optional(),
  }),
  run: async ({ mlsId, radiusMiles, monthsBack }) => {
    return runRentComps(mlsId, null, { radiusMiles, monthsBack });
  },
});
