import { ChatAgent } from "../base/ChatAgent";
import { searchListingsTool, getListingTool } from "../tools/searchListings";
import { webSearchTool } from "../tools/webSearch";
import { buildChatGlobalSystemPrompt } from "./prompt";

/**
 * Global chat agent. Used by the SSE route handler when a conversation's
 * scope=GLOBAL. Reasons over the full result set, scoped by a frozen
 * FilterInput snapshot persisted on the conversation.
 */
export function makeChatGlobalAgent(filterSnapshot: unknown) {
  return new ChatAgent({
    name: "chat-global",
    buildSystemPrompt: () => buildChatGlobalSystemPrompt({ filterSnapshot }),
    tools: [searchListingsTool, getListingTool, webSearchTool],
    maxSteps: 8,
  });
}
