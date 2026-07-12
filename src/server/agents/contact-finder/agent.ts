import { z } from "zod";
import { env } from "@/lib/env";
import { BaseAgent } from "../base/BaseAgent";
import { webSearchTool } from "../tools/webSearch";

/**
 * Headless contact-finder — the "LLM agent" step (step 2) of the
 * contact-enrichment chain (Bridge → LLM agent → Apollo). It reuses the same
 * web_search grounding as the interactive per-asset chat agent
 * (see chat-asset/prompt.ts), but runs on BaseAgent so it returns a structured
 * contact record instead of streaming free-form text into a conversation.
 *
 * It's only asked to fill the agent phone/email the earlier Bridge step
 * couldn't. Every field is nullable — the model returns null for anything it
 * can't verify rather than inventing a value. `finalizeOnMaxSteps` guarantees a
 * structured answer even when a tool-happy model keeps searching (reasoning
 * models otherwise burn every step on web_search and never finalize).
 */

export type ContactGrounding = {
  mlsId: string;
  address: string;
  city: string | null;
  state: string | null;
  bridgeAgent: {
    listAgentName: string | null;
    listAgentMlsId: string | null;
    coListAgentName: string | null;
    officeName: string | null;
  };
  /** Fields already resolved by earlier chain steps (the model fills the gaps). */
  known: {
    agentName: string | null;
    agentPhone: string | null;
    agentEmail: string | null;
    officeName: string | null;
    officePhone: string | null;
    officeEmail: string | null;
  };
};

const inputSchema = z.object({
  mlsId: z.string().min(1),
  grounding: z.string().min(1),
});

const outputSchema = z.object({
  agentName: z.string().nullable().optional(),
  agentPhone: z.string().nullable().optional(),
  agentEmail: z.string().nullable().optional(),
  officeName: z.string().nullable().optional(),
  officePhone: z.string().nullable().optional(),
  officeEmail: z.string().nullable().optional(),
  notes: z.string().nullable().optional(),
});

export type ContactFinderResult = z.infer<typeof outputSchema>;

const SYSTEM_PROMPT = [
  "You are PropScore's contact-resolution worker. Given one MLS listing's agent/office data, find the LISTING AGENT's direct phone number and email address.",
  "",
  "RULES:",
  "- Start from the grounding data provided — Bridge already gives the agent/office name, and some phone/email may already be on file. Only look up what's genuinely missing.",
  "- Use web_search to fill missing phone/email, with a SPECIFIC query — agent full name + brokerage/office name, not a blind search. Prefer the brokerage's own site, the agent's profile page, or the CA DRE record.",
  "- Do AT MOST 2 searches. As soon as you have a phone and/or email (or 2 searches turn up nothing), STOP searching and output the final JSON answer. Do not keep verifying.",
  "- Never invent or guess a phone/email. If you cannot verify a value, return null for it. A confidently-null answer is correct and expected.",
  "- Return the agent's direct/mobile phone when available; fall back to the office line only if that's all that exists.",
  "- Put any useful extra findings (e.g. DRE license number, website) in `notes`.",
].join("\n");

export const contactFinderAgent = new BaseAgent<
  z.infer<typeof inputSchema>,
  ContactFinderResult
>({
  name: "contact-finder",
  systemPrompt: SYSTEM_PROMPT,
  inputSchema,
  outputSchema,
  userMessage: (input) =>
    `Find the listing agent's phone and email for MLS ${input.mlsId}.\n\nGROUNDING (JSON):\n\`\`\`json\n${input.grounding}\n\`\`\``,
  tools: [webSearchTool],
  // ≤2 searches (2 tool round-trips) + a finalize turn; finalizeOnMaxSteps
  // coerces the structured answer if the model still hasn't stopped.
  maxSteps: 4,
  finalizeOnMaxSteps: true,
});

/**
 * Run the contact-finder for one listing. Short-circuits to null when the
 * required keys are missing (no OpenAI key = no model; no Tavily key = the
 * web_search tool errors on every call) or the model surfaces nothing usable.
 * Never throws — the caller (contact-enrichment) treats a null as "this step
 * found nothing" and moves on.
 */
export async function findContactViaAgent(
  grounding: ContactGrounding,
): Promise<ContactFinderResult | null> {
  if (!env.OPENAI_API_KEY || !env.TAVILY_API_KEY) return null;

  try {
    const { output } = await contactFinderAgent.run({
      input: { mlsId: grounding.mlsId, grounding: JSON.stringify(grounding, null, 2) },
    });
    return output;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    // eslint-disable-next-line no-console
    console.warn(`[contacts] mlsId=${grounding.mlsId} contact-finder error: ${message}`);
    return null;
  }
}
