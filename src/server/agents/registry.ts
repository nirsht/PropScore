import { nlFilterAgent } from "./nl-filter/agent";
import { setReasoningAgent } from "./set-reasoning/agent";
import { runAIScoring } from "./ai-scoring/agent";
import { runBuildingVision } from "./building-vision/agent";
import { runListingExtract } from "./listing-extract/agent";
import { runRentComps } from "./rent-comps/agent";
import { makeChatAssetAgent } from "./chat-asset/agent";
import { makeChatGlobalAgent } from "./chat-global/agent";

export const agents = {
  nlFilter: nlFilterAgent,
  setReasoning: setReasoningAgent,
  aiScoring: { run: runAIScoring },
  buildingVision: { run: runBuildingVision },
  listingExtract: { run: runListingExtract },
  rentComps: { run: runRentComps },
  // Chat agents are built per-conversation since the system prompt is
  // grounded in the specific listing or filter snapshot. The route handler
  // calls `make…Agent(...)` and then `runStream(...)` per user turn.
  chatAsset: { make: makeChatAssetAgent },
  chatGlobal: { make: makeChatGlobalAgent },
} as const;

export type AgentName = keyof typeof agents;
