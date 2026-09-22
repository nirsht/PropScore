/**
 * Batch-run the rent-comps agent to refresh SFAR closed-lease comp medians
 * for every LIVE listing with lat/lng. Skips anything refreshed within the
 * last `--max-age-days` (default 7) since rental medians don't move that fast.
 *
 * The agent is deterministic — no LLM calls — but each run hits Bridge for
 * a small bbox query (1mi/24mo, up to 3 pages). bridge-client holds sustained
 * usage under 4500 req/hr (see its sliding-window guard), so the candidate
 * count — not concurrency — is what sets this stage's wall-clock.
 *
 * That is why the `deletedAt: null` filter below is load-bearing, not a
 * nicety: without it the sweep covered all ~100k rows we've ever ingested
 * (97k of them Closed), 71,800 of which were stale on any given night. At
 * the hourly Bridge ceiling that is >16h of quota for listings nothing
 * reads — `latestRentComps` is only ever queried per-listing from the
 * drawer — and it is what timed the daily cron out at ~39k rows processed.
 * Live listings alone are ~1.5k. Same omission d06165e fixed for the other
 * enrichment predicates.
 *
 * Usage:
 *   pnpm tsx scripts/enrich-rent-comps.ts                        # full sweep, concurrency 5
 *   pnpm tsx scripts/enrich-rent-comps.ts --limit=100            # cap rows this run
 *   pnpm tsx scripts/enrich-rent-comps.ts --concurrency=3        # back off if you hit 429s
 *   pnpm tsx scripts/enrich-rent-comps.ts --max-age-days=14      # only refresh older than 14 days
 *   pnpm tsx scripts/enrich-rent-comps.ts --force                # refresh everything (ignores age)
 *   pnpm tsx scripts/enrich-rent-comps.ts --include-deleted      # backfill soft-deleted rows too
 */
import { db } from "@/lib/db";
import { runRentComps } from "@/server/agents/rent-comps/agent";

const args = process.argv.slice(2);
const limitArg = args.find((a) => a.startsWith("--limit="));
const limit = limitArg ? Number(limitArg.split("=")[1]) : undefined;
const concurrencyArg = args.find((a) => a.startsWith("--concurrency="));
const concurrency = concurrencyArg
  ? Math.max(1, Math.min(20, Number(concurrencyArg.split("=")[1])))
  : 5;
const maxAgeArg = args.find((a) => a.startsWith("--max-age-days="));
const maxAgeDays = maxAgeArg ? Number(maxAgeArg.split("=")[1]) : 7;
const force = args.includes("--force");
// Escape hatch for a deliberate backfill over soft-deleted listings. Never
// pass this from the nightly cron — see the header for what it costs.
const includeDeleted = args.includes("--include-deleted");

type Candidate = { mlsId: string };

async function fetchCandidates(): Promise<Candidate[]> {
  // Live listings with lat/lng whose latest rent-comps enrichment is older
  // than the staleness window — or has none at all. force=true keeps the
  // liveness filter and only drops the age check.
  //
  // Ordered oldest-refreshed-first (never-refreshed first) so a `--limit`ed
  // run drains the backlog instead of re-walking the same head of a
  // mlsId-sorted list every night and starving the tail.
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - maxAgeDays);
  return db.$queryRaw<Candidate[]>`
    SELECT l."mlsId"
    FROM "Listing" l
    LEFT JOIN LATERAL (
      SELECT MAX("createdAt") AS last_at
      FROM "AIEnrichment"
      WHERE "listingMlsId" = l."mlsId" AND "agentName" = 'rent-comps'
    ) e ON TRUE
    WHERE l."lat" IS NOT NULL AND l."lng" IS NOT NULL
      AND (${includeDeleted} OR l."deletedAt" IS NULL)
      AND (${force} OR e.last_at IS NULL OR e.last_at < ${cutoff})
    ORDER BY e.last_at ASC NULLS FIRST, l."mlsId" ASC
  `;
}

async function main() {
  const allCandidates = await fetchCandidates();
  const candidates = limit ? allCandidates.slice(0, limit) : allCandidates;
  console.log(
    `[rent-comps] candidates: ${candidates.length}${limit ? ` (limited from ${allCandidates.length})` : ""} concurrency=${concurrency} maxAgeDays=${maxAgeDays}${force ? " (force)" : ""}${includeDeleted ? " (include-deleted)" : ""}`,
  );

  let processed = 0;
  let okWithComps = 0;
  let okEmpty = 0;
  let errored = 0;

  for (let i = 0; i < candidates.length; i += concurrency) {
    const batch = candidates.slice(i, i + concurrency);
    const started = Date.now();
    const results = await Promise.allSettled(
      batch.map((c) => runRentComps(c.mlsId, null)),
    );
    const dur = ((Date.now() - started) / 1000).toFixed(1);

    for (let j = 0; j < results.length; j++) {
      processed += 1;
      const r = results[j]!;
      if (r.status === "fulfilled") {
        if (r.value.totalComps > 0) okWithComps += 1;
        else okEmpty += 1;
      } else {
        errored += 1;
        console.error(`[rent-comps] mlsId=${batch[j]!.mlsId}:`, r.reason);
      }
    }

    console.log(
      `[rent-comps] processed=${processed}/${candidates.length}, comps=${okWithComps}, empty=${okEmpty}, errored=${errored} (batch ${dur}s)`,
    );
  }

  console.log(
    `[rent-comps] done — processed=${processed}, comps=${okWithComps}, empty=${okEmpty}, errored=${errored}`,
  );
}

main()
  .catch((err) => {
    console.error("[rent-comps] failed:", err);
    process.exit(1);
  })
  .finally(() => db.$disconnect());
