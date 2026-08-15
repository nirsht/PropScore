import OpenAI from "openai";
import { env } from "./env";
import { recordUsage, installUsageExitHook } from "./openai-usage";

declare global {
  // eslint-disable-next-line no-var
  var __propscoreOpenAI: OpenAI | undefined;
  // eslint-disable-next-line no-var
  var __propscoreOpenAIWrapped: boolean | undefined;
}

// env.ts keeps OPENAI_API_KEY optional so the free daily cron (which never
// imports this module) doesn't crash at load when the key is absent. Enforce
// it here instead: only OpenAI-spending stages import this file, so a missing
// key fails them loudly — while the free base pipeline stays unaffected.
if (!env.OPENAI_API_KEY) {
  throw new Error(
    "OPENAI_API_KEY is required for OpenAI-backed stages (vision/extract/ai-score/" +
      "contacts/emails-poll/chat) but is not set. The free daily `nightly:base` " +
      "pipeline does not need it; only the paid `nightly:llm` cron and the web app do.",
  );
}

export const openai: OpenAI =
  globalThis.__propscoreOpenAI ??
  new OpenAI({
    apiKey: env.OPENAI_API_KEY,
  });

if (env.NODE_ENV !== "production") {
  globalThis.__propscoreOpenAI = openai;
}

// Transparently record token usage for every non-streaming chat completion so
// each ETL/CLI process can print its OpenAI cost at exit. Wrapping the shared
// client centrally means no call site has to opt in. Guarded so re-imports (or
// the dev globalThis-cached client) don't double-wrap. Streaming completions
// are skipped — they don't return a `usage` object without `include_usage`,
// and the only streaming path is the interactive chat UI, not the ETL.
if (!globalThis.__propscoreOpenAIWrapped) {
  globalThis.__propscoreOpenAIWrapped = true;
  const completions = openai.chat.completions;
  const origCreate = completions.create.bind(completions) as (
    ...args: unknown[]
  ) => Promise<unknown>;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (completions as any).create = async (body: any, options?: unknown) => {
    const res = await origCreate(body, options);
    if (body && !body.stream && res && typeof res === "object" && "usage" in res) {
      const r = res as { model?: string; usage?: Parameters<typeof recordUsage>[1] };
      recordUsage(r.model ?? body.model ?? "unknown", r.usage);
    }
    return res;
  };
  installUsageExitHook();
}

export const OPENAI_MODEL = env.OPENAI_MODEL;
