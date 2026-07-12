/**
 * Nightly orchestrator. Runs in one of three modes:
 *
 *   --mode=base   (default for the daily Render cron — FREE only)
 *     1. etl:sync                                      (must be first)
 *     1b. offboard:stale                               (soft-delete missing)
 *     2. parallel lanes (LLM stages filtered out):
 *          - sfpim → landuse → permits → zoning →
 *            code-enforcement → dbi-complaints →
 *            housing-inventory → rent-control          (share Listing cols)
 *          - rent-comps                                (Bridge, throttled)
 *          - walkscore                                 (Walk Score free tier)
 *          - crime                                     (DataSF, free)
 *     3. refresh:neighborhood-comps
 *     4. recompute:scores                              (heuristic baseline)
 *
 *   --mode=llm    (Mon+Fri Render cron — PAID, OpenAI tokens)
 *     1. etl:sync                                      (self-healing if the
 *                                                       daily base failed
 *                                                       earlier in the day)
 *     2. parallel: [vision → vision-interior], [extract], [contacts]
 *     3. recompute:scores                              (so AI score sees the
 *                                                       fresh heuristic
 *                                                       baseline from new
 *                                                       vision/extract)
 *     4. ai-score:changed
 *     5. emails:poll
 *
 *   --mode=all    (manual/dev — runs everything in the historical order)
 *     The original pre-split pipeline. Kept as the default for `pnpm nightly`
 *     without args so ad-hoc local runs are unchanged.
 *
 * Note: `enrich:contacts` runs in mode=llm — it resolves agent phone/email
 * via the Bridge → LLM agent → Apollo fallback chain (see
 * contact-enrichment.ts). Each source self-skips when its key is absent, and
 * the 30-day freshness window keeps per-run cost bounded.
 *
 * Each stage is a child process so it gets a fresh Prisma client / cursor;
 * we stream each one's stdout/stderr line-tagged into the parent log so
 * concurrent output stays readable. Any failure aborts the run with a
 * non-zero exit code (Promise.all-style fail-fast).
 *
 * Usage:
 *   pnpm nightly                  # mode=all
 *   pnpm nightly:base             # mode=base (daily cron)
 *   pnpm nightly:llm              # mode=llm  (Mon+Fri cron)
 */
import { spawn } from "node:child_process";

type Mode = "base" | "llm" | "all";

type Stage = {
  name: string;
  cmd: string;
  args: string[];
  llm: boolean;
};

function stage(
  name: string,
  script: string,
  scriptArgs: string[] = [],
  opts: { llm?: boolean } = {},
): Stage {
  // pnpm forwards args after `--` to the underlying script.
  const args = scriptArgs.length > 0 ? [script, "--", ...scriptArgs] : [script];
  return { name, cmd: "pnpm", args, llm: opts.llm ?? false };
}

function parseMode(argv: string[]): Mode {
  const flag = argv.find((a) => a.startsWith("--mode="));
  if (!flag) return "all";
  const value = flag.slice("--mode=".length);
  if (value === "base" || value === "llm" || value === "all") return value;
  throw new Error(`Unknown --mode value: ${value} (expected base|llm|all)`);
}

// Per-lane concurrency caps tuned for shared-DB load when all lanes run in
// parallel. Each agent fires several Prisma queries per listing, so the
// effective in-flight query count is ~3-5x these numbers. Standalone
// `pnpm enrich:*` runs keep their higher script defaults.
const PRE: Stage = stage("etl-sync", "etl:sync");
// Offboarding: scan Bridge for the current set of live ListingKeys, mark
// any local Active listing whose key is no longer in Bridge as
// `deletedAt = now()` (soft-delete only; forensic data is preserved). Runs
// after etl-sync so freshly-upserted listings get their lastSeenAt bumped
// before the missing-from-Bridge check fires.
const OFFBOARD: Stage = stage("offboard-stale", "offboard:stale");

const SFPIM = stage("sfpim", "enrich:sfpim", ["--concurrency=5"]);
const VISION = stage("vision", "enrich:vision", ["--concurrency=5"], { llm: true });
// Interior-photo Reno pass — supplements (not replaces) the exterior
// verdict. Overwrites Listing.renovationLevel only when its confidence
// beats the exterior verdict by > 0.1, or when the exterior one is null.
const VISION_INTERIOR = stage(
  "vision-interior",
  "enrich:vision-interior",
  ["--concurrency=5"],
  { llm: true },
);
// landuse + permits join on Listing.blockLot (populated by sfpim);
// zoning needs assessor lot size for RM-* density-by-area rules, so
// they all chain after sfpim in the same lane.
const LANDUSE = stage("landuse", "enrich:landuse", ["--concurrency=3"]);
const PERMITS = stage("permits", "enrich:permits", ["--concurrency=3"]);
const ZONING = stage("zoning", "enrich:zoning", ["--concurrency=5"]);
// Risk & Compliance: code-enforcement + housing-inventory both join on
// blockLot (filled by sfpim); compute:rent-control depends on
// yearBuilt + units + landUseCategory (filled by sfpim + landuse).
const CODE_ENF = stage("code-enforcement", "enrich:code-enforcement", ["--concurrency=3"]);
// DBI inspection complaints (Socrata 9c7e-yn3d) — same Socrata host as
// code-enforcement, same blockLot join.
const DBI_COMPLAINTS = stage("dbi-complaints", "enrich:dbi-complaints", ["--concurrency=3"]);
const HOUSING_INV = stage("housing-inventory", "enrich:housing-inventory", ["--concurrency=3"]);
const RENT_CONTROL = stage("rent-control", "compute:rent-control");

const EXTRACT = stage("extract", "enrich:listings", ["--concurrency=8"], { llm: true });
// Agent contact enrichment — Bridge → LLM agent → Apollo. Its own lane: it
// writes only ListingContact, disjoint from the vision/extract columns.
// Concurrency 3 keeps LLM + Apollo call volume modest.
const CONTACTS = stage("contacts", "enrich:contacts", ["--concurrency=3"], { llm: true });
const RENT_COMPS = stage("rent-comps", "enrich:rent-comps", ["--concurrency=3"]);
const WALKSCORE = stage("walkscore", "refresh:walkscore");
const CRIME = stage("crime", "refresh:crime");

// Original `mode=all` parallel structure — preserved verbatim for backwards
// compatibility with manual `pnpm nightly` runs.
const PARALLEL_LANES_ALL: Stage[][] = [
  [SFPIM, VISION, VISION_INTERIOR, LANDUSE, PERMITS, ZONING, CODE_ENF, DBI_COMPLAINTS, HOUSING_INV, RENT_CONTROL],
  [EXTRACT],
  [RENT_COMPS],
  [WALKSCORE],
  [CRIME],
];

// Base mode: same lanes with LLM stages stripped. Lane 2 (extract) drops
// out entirely since it was a one-stage LLM lane.
const PARALLEL_LANES_BASE: Stage[][] = [
  [SFPIM, LANDUSE, PERMITS, ZONING, CODE_ENF, DBI_COMPLAINTS, HOUSING_INV, RENT_CONTROL],
  [RENT_COMPS],
  [WALKSCORE],
  [CRIME],
];

// LLM mode: vision pair chained (shares Listing.renovationLevel), extract
// runs in parallel (column-disjoint).
const PARALLEL_LANES_LLM: Stage[][] = [
  [VISION, VISION_INTERIOR],
  [EXTRACT],
  [CONTACTS],
];

// Neighborhood comp medians depend on assessor data being populated, so
// run after the parallel phase finishes but before recompute:scores reads
// the medians.
const NEIGHBORHOOD_COMPS: Stage = stage("nb-comps", "refresh:neighborhood-comps");
const POST: Stage = stage("recompute", "recompute:scores");
// Delta AI scoring runs last so it sees the freshest heuristic baseline
// (used as `previousScore` in the prompt) and only re-scores listings
// whose AI input payload hash changed since the last AI run. Concurrency
// 10 keeps wall-clock under the cron timeout on a full re-score (~2.3k
// listings × 3-5s/call ÷ 10 ≈ 12-15 min) — gpt-5-mini stays cheap at this
// fan-out.
const AI_SCORE: Stage = stage("ai-score", "ai-score:changed", ["--concurrency=10"], { llm: true });
// Reply polling — independent of scoring, runs last. The parser writes back
// into Listing.extractedRentRoll, but the next nightly will pick up the new
// rent roll via the normal extract → scoring chain.
const EMAILS_POLL: Stage = stage("emails-poll", "emails:poll", [], { llm: true });

// Per-stage OpenAI cost, harvested from each child's `[openai-cost]
// total_usd=…` line (emitted by src/lib/openai-usage.ts at process exit).
const costByStage = new Map<string, number>();

function runStage(s: Stage): Promise<void> {
  return new Promise((resolve, reject) => {
    const started = Date.now();
    console.log(`[nightly:${s.name}] starting…`);
    const child = spawn(s.cmd, s.args, { stdio: ["ignore", "pipe", "pipe"] });

    const tag = (chunk: Buffer, stream: "stdout" | "stderr") => {
      const text = chunk.toString();
      for (const line of text.split("\n")) {
        if (line.length === 0) continue;
        const m = line.match(/\[openai-cost\] total_usd=([0-9.]+)/);
        if (m) costByStage.set(s.name, (costByStage.get(s.name) ?? 0) + Number(m[1]));
        const w = stream === "stderr" ? process.stderr : process.stdout;
        w.write(`[${s.name}] ${line}\n`);
      }
    };
    child.stdout.on("data", (c) => tag(c, "stdout"));
    child.stderr.on("data", (c) => tag(c, "stderr"));

    child.on("error", reject);
    child.on("exit", (code) => {
      const dur = ((Date.now() - started) / 1000).toFixed(1);
      if (code === 0) {
        console.log(`[nightly:${s.name}] done in ${dur}s`);
        resolve();
      } else {
        reject(new Error(`stage "${s.name}" exited with code ${code} after ${dur}s`));
      }
    });
  });
}

async function runLane(lane: Stage[]): Promise<void> {
  for (const s of lane) await runStage(s);
}

async function runAll() {
  console.log(`[nightly] phase 1: ${PRE.name}`);
  await runStage(PRE);

  console.log(`[nightly] phase 1b: ${OFFBOARD.name}`);
  await runStage(OFFBOARD);

  console.log(
    `[nightly] phase 2: ${PARALLEL_LANES_ALL.length} lanes in parallel — ${PARALLEL_LANES_ALL
      .map((lane) => lane.map((s) => s.name).join("→"))
      .join(", ")}`,
  );
  await Promise.all(PARALLEL_LANES_ALL.map(runLane));

  console.log(`[nightly] phase 3: ${NEIGHBORHOOD_COMPS.name}`);
  await runStage(NEIGHBORHOOD_COMPS);

  console.log(`[nightly] phase 4: ${POST.name}`);
  await runStage(POST);

  console.log(`[nightly] phase 5: ${AI_SCORE.name}`);
  await runStage(AI_SCORE);

  console.log(`[nightly] phase 6: ${EMAILS_POLL.name}`);
  await runStage(EMAILS_POLL);
}

async function runBase() {
  console.log(`[nightly:base] phase 1: ${PRE.name}`);
  await runStage(PRE);

  console.log(`[nightly:base] phase 1b: ${OFFBOARD.name}`);
  await runStage(OFFBOARD);

  console.log(
    `[nightly:base] phase 2: ${PARALLEL_LANES_BASE.length} lanes in parallel — ${PARALLEL_LANES_BASE
      .map((lane) => lane.map((s) => s.name).join("→"))
      .join(", ")}`,
  );
  await Promise.all(PARALLEL_LANES_BASE.map(runLane));

  console.log(`[nightly:base] phase 3: ${NEIGHBORHOOD_COMPS.name}`);
  await runStage(NEIGHBORHOOD_COMPS);

  console.log(`[nightly:base] phase 4: ${POST.name}`);
  await runStage(POST);
}

async function runLlm() {
  console.log(`[nightly:llm] phase 1: ${PRE.name}`);
  await runStage(PRE);

  console.log(
    `[nightly:llm] phase 2: ${PARALLEL_LANES_LLM.length} lanes in parallel — ${PARALLEL_LANES_LLM
      .map((lane) => lane.map((s) => s.name).join("→"))
      .join(", ")}`,
  );
  await Promise.all(PARALLEL_LANES_LLM.map(runLane));

  console.log(`[nightly:llm] phase 3: ${POST.name}`);
  await runStage(POST);

  console.log(`[nightly:llm] phase 4: ${AI_SCORE.name}`);
  await runStage(AI_SCORE);

  console.log(`[nightly:llm] phase 5: ${EMAILS_POLL.name}`);
  await runStage(EMAILS_POLL);
}

function printRunCost(mode: Mode) {
  const entries = [...costByStage.entries()].filter(([, usd]) => usd > 0).sort((a, b) => b[1] - a[1]);
  const total = entries.reduce((sum, [, usd]) => sum + usd, 0);
  console.log(`[nightly] ── OpenAI cost this run (mode=${mode}) ──`);
  if (entries.length === 0) {
    console.log(`[nightly]   (no OpenAI calls — $0.00)`);
  } else {
    for (const [name, usd] of entries) {
      console.log(`[nightly]   ${name.padEnd(18)} $${usd.toFixed(4)}`);
    }
  }
  console.log(`[nightly]   TOTAL              $${total.toFixed(4)}`);
}

async function main() {
  const mode = parseMode(process.argv.slice(2));
  const overallStart = Date.now();
  console.log(`[nightly] mode=${mode}`);

  try {
    if (mode === "all") await runAll();
    else if (mode === "base") await runBase();
    else await runLlm();
  } finally {
    // Print cost even on partial failure so we still account for what was
    // spent before the run aborted.
    printRunCost(mode);
  }

  const total = ((Date.now() - overallStart) / 1000).toFixed(1);
  console.log(`[nightly] all stages succeeded in ${total}s (mode=${mode})`);
}

main().catch((err) => {
  console.error("[nightly] failed:", err instanceof Error ? err.message : err);
  process.exit(1);
});
