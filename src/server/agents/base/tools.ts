import type { ZodSchema } from "zod";

export type ToolDef<TIn = unknown, TOut = unknown> = {
  name: string;
  description: string;
  input: ZodSchema<TIn>;
  run: (input: TIn) => Promise<TOut>;
};

export type ToolCall = { id: string; name: string; args: unknown };

export type ToolResult<T = unknown> = { ok: true; output: T } | { ok: false; error: string };

export function defineTool<TIn, TOut>(def: ToolDef<TIn, TOut>): ToolDef<TIn, TOut> {
  return def;
}
