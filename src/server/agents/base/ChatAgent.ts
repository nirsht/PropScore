import { openai, OPENAI_MODEL } from "@/lib/openai";
import { db } from "@/lib/db";
import type { ToolDef } from "./tools";
import { zodToJsonSchema } from "./jsonSchema";
import type {
  ChatCompletionMessageParam,
  ChatCompletionTool,
  ChatCompletionMessageToolCall,
} from "openai/resources/chat/completions";

/** Stored chat message rows we hand to the agent. */
export type StoredChatMessage = {
  id: string;
  role: "USER" | "ASSISTANT" | "TOOL" | "SYSTEM";
  content: string;
  toolCalls: unknown;
  toolName: string | null;
  toolCallId: string | null;
};

/** Events streamed back to the client. */
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

export type ChatAgentConfig = {
  name: string;
  model?: string;
  /** Built fresh per turn — system prompt may include live listing data. */
  buildSystemPrompt: () => Promise<string> | string;
  tools: ToolDef[];
  /** Hard cap on assistant↔tool round-trips (default 8). */
  maxSteps?: number;
};

/**
 * MLS-id citation marker the model is instructed to emit, e.g. "[mls:424001234]".
 * The route handler extracts these into chips on the client and we store them
 * separately on the ChatMessage row.
 */
const CITE_RE = /\[mls:([A-Za-z0-9_-]+)\]/g;

/**
 * Convert a stored message into the OpenAI message shape. v1 has no user
 * uploads, so user messages are plain text.
 */
function toOpenAIMessage(m: StoredChatMessage): ChatCompletionMessageParam {
  if (m.role === "TOOL") {
    return {
      role: "tool",
      tool_call_id: m.toolCallId ?? "",
      content: m.content,
    };
  }
  if (m.role === "ASSISTANT") {
    const toolCalls = (m.toolCalls as ChatCompletionMessageToolCall[] | null) ?? null;
    return toolCalls && toolCalls.length > 0
      ? {
          role: "assistant",
          content: m.content || null,
          tool_calls: toolCalls,
        }
      : { role: "assistant", content: m.content };
  }
  if (m.role === "SYSTEM") {
    return { role: "system", content: m.content };
  }
  // USER — plain text in v1 (no user uploads).
  return { role: "user", content: m.content };
}

/**
 * ChatAgent — streaming, history-aware sibling to BaseAgent. Designed to be
 * driven from a SSE route handler: callers pass the conversation's stored
 * messages plus a fresh USER message; the agent persists assistant + tool
 * messages to the DB and yields typed stream events the route relays to the
 * client.
 *
 * No json_schema response_format here — chat replies are free-form text. We
 * still get strict-typed tool calls via the OpenAI tools API, and citations
 * are extracted via a [mls:<id>] marker the system prompt instructs the
 * model to emit.
 */
export class ChatAgent {
  constructor(private readonly cfg: ChatAgentConfig) {}

  /**
   * Run one user-turn and yield stream events. The provided `userMessageId`
   * is for the already-persisted USER row; this method writes ASSISTANT and
   * TOOL rows it generates.
   */
  async *runStream(opts: {
    conversationId: string;
    history: StoredChatMessage[];
    userMessageId: string;
  }): AsyncGenerator<ChatStreamEvent, void, undefined> {
    const started = Date.now();
    const tokensTotalIn = 0;
    let tokensTotalOut = 0;
    const maxSteps = this.cfg.maxSteps ?? 8;

    try {
      const systemPrompt = await this.cfg.buildSystemPrompt();

      const toolDefs: ChatCompletionTool[] = this.cfg.tools.map((t) => ({
        type: "function",
        function: {
          name: t.name,
          description: t.description,
          parameters: zodToJsonSchema(t.input),
        },
      }));

      const messages: ChatCompletionMessageParam[] = [
        { role: "system", content: systemPrompt },
      ];
      for (const m of opts.history) messages.push(toOpenAIMessage(m));

      for (let step = 0; step < maxSteps; step++) {
        const stream = await openai.chat.completions.create({
          model: this.cfg.model ?? OPENAI_MODEL,
          messages,
          ...(toolDefs.length > 0 ? { tools: toolDefs, tool_choice: "auto" as const } : {}),
          stream: true,
          stream_options: { include_usage: true },
        });

        let textBuf = "";
        const toolCallsAcc: Map<
          number,
          { id: string; name: string; arguments: string }
        > = new Map();
        const seenCitations = new Set<string>();

        for await (const chunk of stream) {
          const choice = chunk.choices[0];
          if (choice) {
            const delta = choice.delta;
            if (delta?.content) {
              textBuf += delta.content;
              yield { type: "token", text: delta.content };

              // Surface citations as soon as they're complete in the buffer.
              CITE_RE.lastIndex = 0;
              let m: RegExpExecArray | null;
              while ((m = CITE_RE.exec(textBuf)) != null) {
                const id = m[1]!;
                if (!seenCitations.has(id)) {
                  seenCitations.add(id);
                  yield { type: "cite", mlsId: id };
                }
              }
            }
            if (delta?.tool_calls) {
              for (const tc of delta.tool_calls) {
                const idx = tc.index ?? 0;
                const cur = toolCallsAcc.get(idx) ?? {
                  id: "",
                  name: "",
                  arguments: "",
                };
                if (tc.id) cur.id = tc.id;
                if (tc.function?.name) cur.name += tc.function.name;
                if (tc.function?.arguments) {
                  cur.arguments += tc.function.arguments;
                  yield {
                    type: "tool_call_args",
                    callId: cur.id || `idx-${idx}`,
                    argsDelta: tc.function.arguments,
                  };
                }
                if (tc.id && !toolCallsAcc.has(idx)) {
                  yield { type: "tool_call_start", name: cur.name, callId: cur.id };
                }
                toolCallsAcc.set(idx, cur);
              }
            }
          }
          if (chunk.usage) {
            tokensTotalOut += chunk.usage.completion_tokens ?? 0;
          }
        }

        const toolCalls = [...toolCallsAcc.values()].filter((c) => c.name);

        // Persist the assistant message (text + any tool_calls) before
        // continuing the loop. We persist even when tool_calls is empty so
        // resume/history works for partial completions.
        const assistantToolCalls: ChatCompletionMessageToolCall[] = toolCalls.map((c) => ({
          id: c.id || `call_${Math.random().toString(36).slice(2)}`,
          type: "function",
          function: { name: c.name, arguments: c.arguments || "{}" },
        }));

        const assistantRow = await db.chatMessage.create({
          data: {
            conversationId: opts.conversationId,
            role: "ASSISTANT",
            content: textBuf,
            toolCalls: assistantToolCalls.length > 0 ? (assistantToolCalls as object) : undefined,
            citedMlsIds: [...seenCitations],
            tokensOut: tokensTotalOut,
          },
        });
        yield {
          type: "message_complete",
          role: "ASSISTANT",
          messageId: assistantRow.id,
          content: textBuf,
          citedMlsIds: [...seenCitations],
        };

        // Append the assistant turn into the running messages array.
        if (assistantToolCalls.length > 0) {
          messages.push({
            role: "assistant",
            content: textBuf || null,
            tool_calls: assistantToolCalls,
          });
        } else {
          messages.push({ role: "assistant", content: textBuf });
        }

        if (assistantToolCalls.length === 0) {
          // Final answer reached.
          yield {
            type: "done",
            tokensIn: tokensTotalIn,
            tokensOut: tokensTotalOut,
            latencyMs: Date.now() - started,
          };
          return;
        }

        // Execute each tool call sequentially. Persist a TOOL row for each
        // result, surface to the stream, and append to the messages array.
        for (const call of assistantToolCalls) {
          const tool = this.cfg.tools.find((t) => t.name === call.function.name);
          let resultJson: string;
          let ok = true;
          try {
            if (!tool) throw new Error(`Unknown tool: ${call.function.name}`);
            const args = safeParseJSON(call.function.arguments);
            const validated = tool.input.parse(args);
            const output = await tool.run(validated);
            resultJson = JSON.stringify({ ok: true, output });
          } catch (err) {
            ok = false;
            const msg = err instanceof Error ? err.message : String(err);
            resultJson = JSON.stringify({ ok: false, error: msg });
          }

          const toolRow = await db.chatMessage.create({
            data: {
              conversationId: opts.conversationId,
              role: "TOOL",
              content: resultJson,
              toolName: call.function.name,
              toolCallId: call.id,
              errored: !ok,
            },
          });
          yield {
            type: "tool_result",
            callId: call.id,
            name: call.function.name,
            ok,
            preview: shortPreview(resultJson),
          };
          yield {
            type: "message_complete",
            role: "TOOL",
            messageId: toolRow.id,
            content: resultJson,
            toolName: call.function.name,
            toolCallId: call.id,
          };

          messages.push({
            role: "tool",
            tool_call_id: call.id,
            content: resultJson,
          });
        }

        // Loop: model gets a chance to read tool results and either call
        // more tools or finalize.
      }

      yield {
        type: "error",
        message: `${this.cfg.name}: exceeded maxSteps (${maxSteps}) without a final answer`,
      };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      // eslint-disable-next-line no-console
      console.error(`[chat:${this.cfg.name}] failed:`, message, err);
      // Persist the failure as an errored assistant row so the UI can show it.
      try {
        await db.chatMessage.create({
          data: {
            conversationId: opts.conversationId,
            role: "ASSISTANT",
            content: `Error: ${message}`,
            errored: true,
          },
        });
      } catch {
        // ignore
      }
      yield { type: "error", message };
    }
  }
}

function safeParseJSON(s: string): unknown {
  try {
    return JSON.parse(s);
  } catch {
    return {};
  }
}

function shortPreview(s: string, max = 160): string {
  if (s.length <= max) return s;
  return s.slice(0, max - 1) + "…";
}
