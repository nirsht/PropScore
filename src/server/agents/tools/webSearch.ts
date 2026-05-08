import { z } from "zod";
import { defineTool } from "../base/tools";
import { env } from "@/lib/env";

const TAVILY_URL = "https://api.tavily.com/search";

type TavilyResult = {
  title: string;
  url: string;
  content: string;
  score?: number;
  published_date?: string;
};

type TavilyResponse = {
  query: string;
  answer?: string;
  results: TavilyResult[];
};

/**
 * web_search — Tavily-backed general web search. Used by chat agents when a
 * question needs information that isn't in PropScore's database (current
 * mortgage rates, recent SF zoning news, market conditions, etc.).
 *
 * Returns a compact list of results plus Tavily's auto-generated short
 * answer if present. Capped at 5 results to keep tool-call payloads small.
 */
export const webSearchTool = defineTool({
  name: "web_search",
  description:
    "Search the public web for facts not in the PropScore database — e.g. current mortgage rates, recent zoning changes, neighborhood news, comparable market data. Returns title/url/snippet for each result and Tavily's auto-generated short answer when available. Use sparingly: prefer the database first.",
  input: z.object({
    query: z.string().min(1).describe("The search query, in natural language."),
    maxResults: z.number().int().min(1).max(10).optional().default(5),
    topic: z.enum(["general", "news"]).optional().default("general"),
  }),
  run: async ({ query, maxResults, topic }) => {
    if (!env.TAVILY_API_KEY) {
      throw new Error(
        "web_search is unavailable: TAVILY_API_KEY is not set. Add it to .env (free key at https://tavily.com).",
      );
    }
    const res = await fetch(TAVILY_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${env.TAVILY_API_KEY}`,
      },
      body: JSON.stringify({
        query,
        max_results: maxResults,
        topic,
        include_answer: true,
        search_depth: "basic",
      }),
    });
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      throw new Error(`Tavily ${res.status}: ${text || res.statusText}`);
    }
    const data = (await res.json()) as TavilyResponse;
    return {
      query: data.query,
      answer: data.answer ?? null,
      results: data.results.slice(0, maxResults).map((r) => ({
        title: r.title,
        url: r.url,
        snippet: r.content,
        publishedDate: r.published_date ?? null,
      })),
    };
  },
});
