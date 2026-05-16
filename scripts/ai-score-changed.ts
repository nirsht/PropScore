/**
 * Run AI opportunity scoring for every Listing whose AI-input payload has
 * changed since the last AI run (or never been AI-scored). Hash-based
 * delta: build the slim payload, sha256 it, compare to `Score.aiInputHash`,
 * skip if equal.
 *
 * Designed to be the final stage of `pnpm nightly`. On the first nightly
 * after this lands, every listing has `aiInputHash IS NULL` and will be
 * scored — that's the one-shot full backfill (~$7.50 at ~$0.005/listing
 * for ~1,500 listings against GPT-5).
 *
 * Usage:
 *   pnpm ai-score:changed                       # full delta, concurrency 5
 *   pnpm ai-score:changed --concurrency=3
 *   pnpm ai-score:changed --max=50              # cap this run (staged rollout / incident throttle)
 *   pnpm ai-score:changed --force               # ignore hash, re-score every listing
 *   pnpm ai-score:changed --dry-run             # report counts only, no API calls
 */
import { db } from "@/lib/db";
import { mapWithConcurrency } from "@/lib/concurrency";
import { runAIScoring } from "@/server/agents/ai-scoring/agent";
import {
  buildAIScoringInput,
  hashAIScoringInput,
} from "@/server/agents/ai-scoring/input";

const args = process.argv.slice(2);
const concurrencyArg = args.find((a) => a.startsWith("--concurrency="));
const concurrency = concurrencyArg
  ? Math.max(1, Math.min(20, Number(concurrencyArg.split("=")[1])))
  : 5;
const maxArg = args.find((a) => a.startsWith("--max="));
const maxCap = maxArg ? Math.max(1, Number(maxArg.split("=")[1])) : Number.POSITIVE_INFINITY;
const force = args.includes("--force");
const dryRun = args.includes("--dry-run");

const BATCH = 200;

async function main() {
  const total = await db.listing.count();
  console.log(
    `[ai-score] total listings: ${total} concurrency=${concurrency}${force ? " (force)" : ""}${dryRun ? " (dry-run)" : ""}${maxCap !== Number.POSITIVE_INFINITY ? ` max=${maxCap}` : ""}`,
  );

  let cursor: string | undefined;
  let processed = 0;
  let scored = 0;
  let skipped = 0;
  let errored = 0;
  let scoreCalls = 0;

  while (scoreCalls < maxCap) {
    const batch = await db.listing.findMany({
      take: BATCH,
      ...(cursor ? { skip: 1, cursor: { mlsId: cursor } } : {}),
      orderBy: { mlsId: "asc" },
      include: { score: true },
    });
    if (batch.length === 0) break;

    // Decide which rows need to be scored before kicking off any LLM calls,
    // so `--max` is honored even when the batch is mostly skips.
    type Decision = { mlsId: string; action: "skip" | "score" };
    const decisions: Decision[] = [];
    for (const l of batch) {
      const slim = buildAIScoringInput(l);
      const hash = hashAIScoringInput(slim);
      const existing = l.score?.aiInputHash ?? null;
      const needsScore = force || existing == null || existing !== hash;
      decisions.push({ mlsId: l.mlsId, action: needsScore ? "score" : "skip" });
    }

    const toScore: string[] = [];
    for (const d of decisions) {
      if (d.action === "skip") {
        skipped += 1;
        continue;
      }
      if (scoreCalls + toScore.length >= maxCap) break;
      toScore.push(d.mlsId);
    }

    if (toScore.length > 0 && !dryRun) {
      const results = await mapWithConcurrency(toScore, concurrency, async (mlsId) => {
        await runAIScoring(mlsId, null);
      });
      for (let i = 0; i < results.length; i++) {
        const r = results[i]!;
        if (r.status === "fulfilled") {
          scored += 1;
        } else {
          errored += 1;
          console.error(`[ai-score] mlsId=${toScore[i]}:`, r.reason);
        }
      }
    } else if (toScore.length > 0 && dryRun) {
      scored += toScore.length;
    }
    scoreCalls += toScore.length;

    processed += batch.length;
    cursor = batch[batch.length - 1]?.mlsId;
    console.log(
      `[ai-score] processed=${processed}/${total} scored=${scored} skipped=${skipped} errored=${errored}${maxCap !== Number.POSITIVE_INFINITY ? ` (cap=${maxCap})` : ""}`,
    );
  }

  if (scored > 0 && !dryRun) {
    console.log(`[ai-score] refreshing materialized view…`);
    await db.$executeRawUnsafe(
      `REFRESH MATERIALIZED VIEW CONCURRENTLY "mv_listing_search"`,
    );
  }

  console.log(
    `[ai-score] done — scored=${scored} skipped=${skipped} errored=${errored}`,
  );
  if (errored > 0) process.exit(1);
}

main()
  .catch((err) => {
    console.error("[ai-score] failed:", err);
    process.exit(1);
  })
  .finally(() => db.$disconnect());
