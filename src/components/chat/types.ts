export type ChatScope = "ASSET" | "GLOBAL";

export type ChatStreamEvent =
  | { type: "token"; text: string }
  | { type: "tool_call_start"; name: string; callId: string }
  | { type: "tool_call_args"; callId: string; argsDelta: string }
  | { type: "tool_result"; callId: string; name: string; ok: boolean; preview?: string }
  | { type: "cite"; mlsId: string }
  | {
      type: "message_complete";
      role: "ASSISTANT" | "TOOL";
      messageId: string;
      content: string;
      toolName?: string | null;
      toolCallId?: string | null;
      citedMlsIds?: string[];
    }
  | { type: "done"; tokensIn: number; tokensOut: number; latencyMs: number }
  | { type: "error"; message: string };

/** UI-side message: shape we render (server rows + drafts in flight). */
export type UIMessage = {
  id: string;
  role: "USER" | "ASSISTANT" | "TOOL" | "SYSTEM";
  content: string;
  toolName?: string | null;
  citedMlsIds?: string[];
  errored?: boolean;
  pending?: boolean;
};
