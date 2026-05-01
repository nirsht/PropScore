import { nlFilterAgent } from "./nl-filter/agent";
import { setReasoningAgent } from "./set-reasoning/agent";
import { runAIScoring } from "./ai-scoring/agent";
import { runRentGrowth } from "./rent-growth/agent";
import { runBuildingVision } from "./building-vision/agent";
import { runListingExtract } from "./listing-extract/agent";

export const agents = {
  nlFilter: nlFilterAgent,
  setReasoning: setReasoningAgent,
  aiScoring: { run: runAIScoring },
  rentGrowth: { run: runRentGrowth },
  buildingVision: { run: runBuildingVision },
  listingExtract: { run: runListingExtract },
} as const;

export type AgentName = keyof typeof agents;
