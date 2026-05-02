import { nlFilterAgent } from "./nl-filter/agent";
import { setReasoningAgent } from "./set-reasoning/agent";
import { runAIScoring } from "./ai-scoring/agent";
import { runBuildingVision } from "./building-vision/agent";
import { runListingExtract } from "./listing-extract/agent";
import { runRentComps } from "./rent-comps/agent";

export const agents = {
  nlFilter: nlFilterAgent,
  setReasoning: setReasoningAgent,
  aiScoring: { run: runAIScoring },
  buildingVision: { run: runBuildingVision },
  listingExtract: { run: runListingExtract },
  rentComps: { run: runRentComps },
} as const;

export type AgentName = keyof typeof agents;
