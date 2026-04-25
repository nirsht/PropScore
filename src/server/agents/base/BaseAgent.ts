import { z, type ZodSchema } from "zod";
import { zodToJsonSchema } from "./jsonSchema";
import { db } from "@/lib/db";
import { openai, OPENAI_MODEL } from "@/lib/openai";
import type { ToolDef, ToolCall, ToolResult } from "./tools";
import type { ChatCompletionMessageParam, ChatCompletionTool } from "openai/resources/chat/completions";

export type AgentRunInput<TIn> = {
  input: TIn;
  userId?: string | null;
};

export type AgentRunResult<TOut> = {
  output: TOut;
  steps: AgentStep[];
  tokens: number;
  latencyMs: number;
};

export type AgentStep =
  | { type: "model"; content: string | null; toolCalls?: ToolCall[] }
  | { type: "tool"; name: string; input: unknown; output: unknown; error?: string };

export type BaseAgentConfig<TIn, TOut> = {
  name: string;
  model?: string;
  systemPrompt: string;
  inputSchema: ZodSchema<TIn>;
  outputSchema: ZodSchema<TOut>;
  /** User-message template — receives validated input. */
  userMessage: (input: TIn) => string;
  /** Tools this agent is allowed to call. Empty = no tool use. */
  tools?: ToolDef[];
  /** Max LLM round-trips (each may include tool calls). Default 6. */
  maxSteps?: number;
};

/**
 * BaseAgent — small, opinionated runtime: one prompt, structured output,
 * tool-call loop, retry on parse failure, and a persisted AgentTrace per run.
 */
export class BaseAgent<TIn, TOut> {
  constructor(private readonly cfg: BaseAgentConfig<TIn, TOut>) {}

  async run({ input, userId }: AgentRunInput<TIn>): Promise<AgentRunResult<TOut>> {
    const started = Date.now();
    const validatedInput = this.cfg.inputSchema.parse(input);
    const steps: AgentStep[] = [];
    let totalTokens = 0;

    const trace = await db.agentTrace.create({
      data: {
        agentName: this.cfg.name,
        userId: userId ?? null,
        input: validatedInput as object,
      },
    });

    try {
      const tools = this.cfg.tools ?? [];
      const toolDefs: ChatCompletionTool[] = tools.map((t) => ({
        type: "function",
        function: {
          name: t.name,
          description: t.description,
          parameters: zodToJsonSchema(t.input),
        },
      }));

      const messages: ChatCompletionMessageParam[] = [
        { role: "system", content: this.cfg.systemPrompt },
        { role: "user", content: this.cfg.userMessage(validatedInput) },
      ];

      const finalSchemaName = `${this.cfg.name.replace(/[^a-z0-9_]/gi, "_")}_output`;
      // strict:false — OpenAI's strict mode requires every property to be in
      // `required` and additionalProperties:false at every level. Our zod
      // schemas use optional/nullable/default, which strict rejects. We
      // validate the output via zod post-hoc instead, which is just as safe.
      const responseFormat = {
        type: "json_schema" as const,
        json_schema: {
          name: finalSchemaName,
          strict: false,
          schema: zodToJsonSchema(this.cfg.outputSchema),
        },
      };

      const maxSteps = this.cfg.maxSteps ?? 6;

      for (let step = 0; step < maxSteps; step++) {
        const completion = await openai.chat.completions.create({
          model: this.cfg.model ?? OPENAI_MODEL,
          messages,
          ...(toolDefs.length > 0 ? { tools: toolDefs, tool_choice: "auto" as const } : {}),
          // Always send response_format — gpt-4o accepts tools + response_format
          // together. When the model wants to use a tool it emits tool_calls
          // with content=null (response_format is ignored on that turn); when
          // it finalizes, it emits JSON-shaped content. Without this, the
          // final-turn content was free-form text and failed schema validation.
          response_format: responseFormat,
        });

        totalTokens += completion.usage?.total_tokens ?? 0;
        const choice = completion.choices[0];
        if (!choice) throw new Error(`${this.cfg.name}: model returned no choices`);

        const msg = choice.message;
        steps.push({
          type: "model",
          content: msg.content ?? null,
          toolCalls: msg.tool_calls?.map((c) => ({
            id: c.id,
            name: c.function.name,
            args: tryParseJSON(c.function.arguments),
          })),
        });
        messages.push(msg);

        if (msg.tool_calls?.length) {
          for (const call of msg.tool_calls) {
            const tool = tools.find((t) => t.name === call.function.name);
            const args = tryParseJSON(call.function.arguments);
            let result: ToolResult;
            try {
              if (!tool) throw new Error(`Unknown tool: ${call.function.name}`);
              const parsedArgs = tool.input.parse(args);
              const output = await tool.run(parsedArgs);
              result = { ok: true, output };
            } catch (err) {
              const message = err instanceof Error ? err.message : String(err);
              result = { ok: false, error: message };
            }
            steps.push({
              type: "tool",
              name: call.function.name,
              input: args,
              output: result.ok ? result.output : undefined,
              error: result.ok ? undefined : result.error,
            });
            messages.push({
              role: "tool",
              tool_call_id: call.id,
              content: JSON.stringify(result),
            });
          }
          continue;
        }

        // No tool calls — the model has produced the final structured answer.
        const parsed = this.parseFinal(msg.content ?? "");
        const finishedAt = Date.now();
        await db.agentTrace.update({
          where: { id: trace.id },
          data: {
            output: parsed as object,
            steps: steps as object,
            tokens: totalTokens,
            latencyMs: finishedAt - started,
          },
        });
        return { output: parsed, steps, tokens: totalTokens, latencyMs: finishedAt - started };
      }

      throw new Error(`${this.cfg.name}: exceeded maxSteps (${maxSteps}) without a final answer`);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      // Surface the failure server-side so it's visible in the dev terminal
      // alongside the 500 response.
      // eslint-disable-next-line no-console
      console.error(`[agent:${this.cfg.name}] failed:`, message, err);
      await db.agentTrace.update({
        where: { id: trace.id },
        data: {
          steps: steps as object,
          tokens: totalTokens,
          latencyMs: Date.now() - started,
          error: message,
        },
      });
      throw err;
    }
  }

  private parseFinal(content: string): TOut {
    const json = tryParseJSON(content);
    const parsed = this.cfg.outputSchema.safeParse(json);
    if (!parsed.success) {
      throw new Error(
        `${this.cfg.name}: output failed schema validation — ${parsed.error.message}`,
      );
    }
    return parsed.data;
  }
}

function tryParseJSON(s: string): unknown {
  try {
    return JSON.parse(s);
  } catch {
    return null;
  }
}

export { z };
