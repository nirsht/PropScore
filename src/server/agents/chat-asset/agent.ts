import { ChatAgent } from "../base/ChatAgent";
import { getListingTool } from "../tools/searchListings";
import { fetchRentCompsTool } from "../tools/fetchRentComps";
import { fetchParcelTool } from "../tools/fetchParcel";
import { triggerAiScoringTool } from "../tools/triggerAiScoring";
import { webSearchTool } from "../tools/webSearch";
import { buildChatAssetSystemPrompt } from "./prompt";

/**
 * Per-asset chat agent. Used by the SSE route handler when a conversation's
 * scope=ASSET. The system prompt is rebuilt every turn so listing edits or
 * new enrichments show up without restarting the conversation.
 */
export function makeChatAssetAgent(mlsId: string) {
  return new ChatAgent({
    name: `chat-asset:${mlsId}`,
    buildSystemPrompt: () => buildChatAssetSystemPrompt(mlsId),
    tools: [
      getListingTool,
      fetchRentCompsTool,
      fetchParcelTool,
      triggerAiScoringTool,
      webSearchTool,
    ],
    maxSteps: 8,
  });
}
