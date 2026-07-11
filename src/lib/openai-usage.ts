/**
 * Central OpenAI usage + cost accounting.
 *
 * `src/lib/openai.ts` wraps `openai.chat.completions.create` so every
 * non-streaming completion records its usage here, keyed by model. Any script
 * or cron process that makes OpenAI calls therefore prints a cost summary at
 * exit (see the `process.on("exit")` hook below) — this is what makes each ETL
 * run self-report "this run cost $X".
 *
 * The token counts OpenAI returns already fold in image-token accounting
 * (notably gpt-4o-mini bills vision images at a much higher token multiplier
 * than gpt-4o), so we just multiply reported tokens by the per-model $ rate —
 * no manual image math needed.
 */

// USD per 1,000,000 tokens. Matched by prefix so dated snapshots
// (e.g. "gpt-4o-2024-11-20") resolve to their family.
//
// ⚠️ VERIFY against current https://openai.com/api/pricing — these are the
// rates as configured for PropScore's account; edit here if OpenAI changes
// them. Cost math lives in exactly one place so a price change is a one-liner.
type Price = { input: number; cachedInput: number; output: number };

const PRICES: Array<{ prefix: string; price: Price }> = [
  // Most-specific prefixes first (mini before base).
  { prefix: "gpt-4o-mini", price: { input: 0.15, cachedInput: 0.075, output: 0.6 } },
  { prefix: "gpt-4o", price: { input: 2.5, cachedInput: 1.25, output: 10.0 } },
  { prefix: "gpt-5-mini", price: { input: 0.25, cachedInput: 0.025, output: 2.0 } },
  { prefix: "gpt-5", price: { input: 1.25, cachedInput: 0.125, output: 10.0 } },
];

const UNKNOWN_PRICE: Price = { input: 1.0, cachedInput: 0.5, output: 3.0 };

function priceFor(model: string): Price {
  for (const { prefix, price } of PRICES) {
    if (model.startsWith(prefix)) return price;
  }
  return UNKNOWN_PRICE;
}

export type ModelUsage = {
  calls: number;
  inputTokens: number; // includes cached
  cachedTokens: number;
  outputTokens: number;
};

const byModel = new Map<string, ModelUsage>();

/** Record one completion's usage. Called by the openai.ts client wrapper. */
export function recordUsage(
  model: string,
  usage: {
    prompt_tokens?: number | null;
    completion_tokens?: number | null;
    prompt_tokens_details?: { cached_tokens?: number | null } | null;
  } | null | undefined,
): void {
  if (!usage) return;
  const m = byModel.get(model) ?? {
    calls: 0,
    inputTokens: 0,
    cachedTokens: 0,
    outputTokens: 0,
  };
  m.calls += 1;
  m.inputTokens += usage.prompt_tokens ?? 0;
  m.cachedTokens += usage.prompt_tokens_details?.cached_tokens ?? 0;
  m.outputTokens += usage.completion_tokens ?? 0;
  byModel.set(model, m);
}

export function costForModel(model: string, u: ModelUsage): number {
  const p = priceFor(model);
  const uncached = Math.max(u.inputTokens - u.cachedTokens, 0);
  return (
    (uncached * p.input) / 1e6 +
    (u.cachedTokens * p.cachedInput) / 1e6 +
    (u.outputTokens * p.output) / 1e6
  );
}

export type UsageSummary = {
  totalUsd: number;
  totalTokens: number;
  inputTokens: number;
  outputTokens: number;
  byModel: Array<{ model: string; usage: ModelUsage; usd: number }>;
};

export function usageSummary(): UsageSummary {
  let totalUsd = 0;
  let inputTokens = 0;
  let outputTokens = 0;
  const rows: UsageSummary["byModel"] = [];
  for (const [model, usage] of byModel) {
    const usd = costForModel(model, usage);
    totalUsd += usd;
    inputTokens += usage.inputTokens;
    outputTokens += usage.outputTokens;
    rows.push({ model, usage, usd });
  }
  rows.sort((a, b) => b.usd - a.usd);
  return {
    totalUsd,
    totalTokens: inputTokens + outputTokens,
    inputTokens,
    outputTokens,
    byModel: rows,
  };
}

/**
 * Print a machine-parseable + human-readable cost summary. The
 * `[openai-cost] total_usd=…` line is parsed by scripts/nightly.ts to
 * aggregate a per-run grand total across all stage child processes.
 */
export function printUsageSummary(): void {
  const s = usageSummary();
  if (s.byModel.length === 0) return; // process made no OpenAI calls
  for (const { model, usage, usd } of s.byModel) {
    // eslint-disable-next-line no-console
    console.log(
      `[openai-cost] model=${model} calls=${usage.calls} input=${usage.inputTokens} cached=${usage.cachedTokens} output=${usage.outputTokens} usd=${usd.toFixed(4)}`,
    );
  }
  // eslint-disable-next-line no-console
  console.log(
    `[openai-cost] total_usd=${s.totalUsd.toFixed(4)} total_tokens=${s.totalTokens} input=${s.inputTokens} output=${s.outputTokens}`,
  );
}

let hookInstalled = false;
/** Install a once-per-process exit hook that prints the summary. */
export function installUsageExitHook(): void {
  if (hookInstalled) return;
  hookInstalled = true;
  process.on("exit", () => {
    try {
      printUsageSummary();
    } catch {
      // never let cost reporting break a run
    }
  });
}
