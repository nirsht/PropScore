/**
 * Nightly orchestrator. Runs the full enrichment pipeline with as much
 * concurrency as is safe given which stages share Listing columns.
 *
 *   1. etl:sync                                              (must be first)
 *   2. parallel:
 *        - enrich:sfpim → enrich:vision → enrich:zoning  (all write Listing.raw or Listing → serial)
 *        - enrich:listings                (disjoint columns)
 *        - enrich:rent-comps              (writes AIEnrichment, throttled)
 *        - refresh:walkscore              (Listing.walkScore only)
 *        - refresh:crime                  (Neighborhood table only)
 *   3. refresh:neighborhood-comps         (reads listings/assessor + writes Neighborhood medians)
 *   4. recompute:scores                   (heuristic; skips AI rows)
 *   5. ai-score:changed                   (delta: re-score only listings whose AI inputs changed)
 *
 * Each stage is a child process so it gets a fresh Prisma client / cursor;
 * we stream each one's stdout/stderr line-tagged into the parent log so
 * concurrent output stays readable. Any failure aborts the run with a
 * non-zero exit code (Promise.all-style fail-fast).
 *
 * Usage: pnpm nightly
 */
import { spawn } from "node:child_process";

type Stage = { name: string; cmd: string; args: string[] };

function stage(name: string, script: string, scriptArgs: string[] = []): Stage {
  // pnpm forwards args after `--` to the underlying script.
  const args = scriptArgs.length > 0 ? [script, "--", ...scriptArgs] : [script];
  return { name, cmd: "pnpm", args };
}

// Per-lane concurrency caps tuned for shared-DB load when all lanes run in
// parallel. Each agent fires several Prisma queries per listing, so the
// effective in-flight query count is ~3-5x these numbers. Standalone
// `pnpm enrich:*` runs keep their higher script defaults.
const PRE: Stage = stage("etl-sync", "etl:sync");
// `landuse` and `permits` join on `Listing.blockLot`, which is populated by
// `enrich:sfpim`. They run after sfpim in the same lane, parallel with the
// other lanes that don't depend on parcel IDs.
const PARALLEL_LANES: Stage[][] = [
  [
    stage("sfpim", "enrich:sfpim", ["--concurrency=5"]),
    stage("vision", "enrich:vision", ["--concurrency=5"]),
    // landuse + permits join on Listing.blockLot (populated by sfpim);
    // zoning needs assessor lot size for RM-* density-by-area rules, so
    // they all chain after sfpim in the same lane.
    stage("landuse", "enrich:landuse", ["--concurrency=3"]),
    stage("permits", "enrich:permits", ["--concurrency=3"]),
    stage("zoning", "enrich:zoning", ["--concurrency=5"]),
    // Risk & Compliance: code-enforcement + housing-inventory both join on
    // blockLot (filled by sfpim); compute:rent-control depends on
    // yearBuilt + units + landUseCategory (filled by sfpim + landuse). Run
    // them serially in this lane after the upstream stages so we don't race
    // on Listing rows.
    stage("code-enforcement", "enrich:code-enforcement", ["--concurrency=3"]),
    stage("housing-inventory", "enrich:housing-inventory", ["--concurrency=3"]),
    stage("rent-control", "compute:rent-control"),
  ],
  [stage("extract", "enrich:listings", ["--concurrency=8"])],
  [stage("rent-comps", "enrich:rent-comps", ["--concurrency=3"])],
  [stage("walkscore", "refresh:walkscore")],
  [stage("crime", "refresh:crime")],
  // Contacts only write to ListingContact (disjoint from every other lane)
  // and the upstream RentCast API caps us per-second, so they're cheap to
  // run in parallel. Auto-email-rent-roll chains after contacts in the same
  // lane because it needs ListingContact.agentEmail to be populated, and it
  // gates itself on env.EMAIL_AUTO_ENABLED.
  [
    stage("contacts", "enrich:contacts", ["--concurrency=3"]),
    stage("emails-auto", "emails:auto"),
  ],
];
// Neighborhood comp medians depend on assessor data being populated, so
// run after the parallel phase finishes but before recompute:scores reads
// the medians.
const NEIGHBORHOOD_COMPS: Stage = stage("nb-comps", "refresh:neighborhood-comps");
const POST: Stage = stage("recompute", "recompute:scores");
// Delta AI scoring runs last so it sees the freshest heuristic baseline
// (used as `previousScore` in the prompt) and only re-scores listings
// whose AI input payload hash changed since the last AI run.
const AI_SCORE: Stage = stage("ai-score", "ai-score:changed");
// Reply polling — independent of scoring, runs last. The parser writes back
// into Listing.extractedRentRoll, but the next nightly will pick up the new
// rent roll via the normal extract → scoring chain.
const EMAILS_POLL: Stage = stage("emails-poll", "emails:poll");

function runStage(s: Stage): Promise<void> {
  return new Promise((resolve, reject) => {
    const started = Date.now();
    console.log(`[nightly:${s.name}] starting…`);
    const child = spawn(s.cmd, s.args, { stdio: ["ignore", "pipe", "pipe"] });

    const tag = (chunk: Buffer, stream: "stdout" | "stderr") => {
      const text = chunk.toString();
      for (const line of text.split("\n")) {
        if (line.length === 0) continue;
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

async function main() {
  const overallStart = Date.now();

  console.log(`[nightly] phase 1: ${PRE.name}`);
  await runStage(PRE);

  console.log(
    `[nightly] phase 2: ${PARALLEL_LANES.length} lanes in parallel — ${PARALLEL_LANES
      .map((lane) => lane.map((s) => s.name).join("→"))
      .join(", ")}`,
  );
  await Promise.all(PARALLEL_LANES.map(runLane));

  console.log(`[nightly] phase 3: ${NEIGHBORHOOD_COMPS.name}`);
  await runStage(NEIGHBORHOOD_COMPS);

  console.log(`[nightly] phase 4: ${POST.name}`);
  await runStage(POST);

  console.log(`[nightly] phase 5: ${AI_SCORE.name}`);
  await runStage(AI_SCORE);

  console.log(`[nightly] phase 6: ${EMAILS_POLL.name}`);
  await runStage(EMAILS_POLL);

  const total = ((Date.now() - overallStart) / 1000).toFixed(1);
  console.log(`[nightly] all stages succeeded in ${total}s`);
}

main().catch((err) => {
  console.error("[nightly] failed:", err instanceof Error ? err.message : err);
  process.exit(1);
});
