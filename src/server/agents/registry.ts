import { nlFilterAgent } from "./nl-filter/agent";
import { setReasoningAgent } from "./set-reasoning/agent";
import { runAIScoring } from "./ai-scoring/agent";
import { runRentGrowth } from "./rent-growth/agent";

export const agents = {
  nlFilter: nlFilterAgent,
  setReasoning: setReasoningAgent,
  aiScoring: { run: runAIScoring },
  rentGrowth: { run: runRentGrowth },
} as const;

export type AgentName = keyof typeof agents;
