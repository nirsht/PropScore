import { BaseAgent } from "../base/BaseAgent";
import { searchListingsTool, getListingTool } from "../tools/searchListings";
import { SET_REASONING_SYSTEM_PROMPT, setReasoningUserMessage } from "./prompt";
import { SetReasoningInput, SetReasoningOutput } from "./schema";

export const setReasoningAgent = new BaseAgent({
  name: "set-reasoning",
  systemPrompt: SET_REASONING_SYSTEM_PROMPT,
  inputSchema: SetReasoningInput,
  outputSchema: SetReasoningOutput,
  userMessage: setReasoningUserMessage,
  tools: [searchListingsTool, getListingTool],
  maxSteps: 6,
});
