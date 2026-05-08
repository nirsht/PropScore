import { countListings } from "@/server/api/listings-search";
import { FilterInput, type FilterInput as FilterInputT } from "@/server/api/schemas/filter";

/**
 * Build the global chat system prompt. The conversation carries a frozen
 * filterSnapshot (taken at thread creation time); we hydrate it into a row
 * count so the model knows the universe it's reasoning over without
 * dumping all rows into the prompt. Tool calls fetch specifics on demand.
 */
export async function buildChatGlobalSystemPrompt(opts: {
  filterSnapshot: unknown;
}): Promise<string> {
  let snapshot: FilterInputT | null = null;
  let snapshotError: string | null = null;
  try {
    if (opts.filterSnapshot) {
      snapshot = FilterInput.parse(opts.filterSnapshot);
    }
  } catch (err) {
    snapshotError = err instanceof Error ? err.message : String(err);
  }

  let matchingRows = 0;
  let totalRows = 0;
  try {
    if (snapshot) {
      matchingRows = await countListings(snapshot);
    }
    totalRows = await countListings(FilterInput.parse({}));
  } catch {
    // FilterInput defaults must validate; this only catches transient DB errors.
  }

  return [
    "You are PropScore's global chat assistant. The user is asking questions about a set of MLS listings (San Francisco residential / multi-unit).",
    "",
    "GROUNDING RULES:",
    "- Always ground specific claims by calling search_listings or get_listing. Do not invent listings, prices, or addresses.",
    "- For market-wide or current-events questions (mortgage rates, recent zoning), use web_search.",
    "- When you cite a specific listing, write it as [mls:<mlsId>] inline so the UI can render a chip the user can click.",
    "- Prefer concrete answers: 5–10 specific listings is more useful than vague generalities.",
    "- Be concise. Use bullets/short tables when comparing.",
    "",
    snapshot
      ? `CURRENT FILTER CONTEXT:\nThe user opened this conversation while looking at a filtered result set. The filter is frozen for this thread (the on-screen filter may have drifted; the user can start a new thread to use the latest filter).\n\nFilter (FilterInput JSON):\n\`\`\`json\n${JSON.stringify(
          snapshot,
          null,
          2,
        )}\n\`\`\`\n\nMatching rows at thread creation: ${matchingRows} of ${totalRows} total.\n\nWhen the user says "these listings" or "this set", they mean rows matching this filter — call search_listings with this filter as a starting point.`
      : `CURRENT FILTER CONTEXT:\nNo filter snapshot for this thread — assume the user is asking about the full ${totalRows}-row corpus. Use search_listings with sensible filters before claiming anything specific.`,
    snapshotError
      ? `\n(Note: stored filter failed to parse — ${snapshotError}. Operate on the full corpus.)`
      : "",
  ].join("\n");
}
