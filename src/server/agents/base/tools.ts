import type { ZodSchema } from "zod";

// `any` defaults (rather than `unknown`) so an array of typed tools is
// assignable to `ToolDef[]`. Variance on the `run` parameter would otherwise
// reject Tool<{specific input}> as a Tool<unknown>. Internally the runtime
// validates each tool's input through its zod schema so this is type-erasing
// at the boundary, not at use.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type ToolDef<TIn = any, TOut = any> = {
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
