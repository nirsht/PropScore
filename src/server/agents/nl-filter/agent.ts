import { BaseAgent } from "../base/BaseAgent";
import { NL_FILTER_SYSTEM_PROMPT, userMessageTemplate } from "./prompt";
import { NLFilterInput, NLFilterOutput } from "./schema";

export const nlFilterAgent = new BaseAgent({
  name: "nl-filter",
  systemPrompt: NL_FILTER_SYSTEM_PROMPT,
  inputSchema: NLFilterInput,
  outputSchema: NLFilterOutput,
  userMessage: userMessageTemplate,
  // No tools — pure NL → structured output. Hot path; keep it tight.
  tools: [],
  maxSteps: 1,
});
