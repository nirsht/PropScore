/**
 * Batch-run the rent-comps agent to refresh SFAR closed-lease comp medians
 * for every listing with lat/lng. Skips anything refreshed within the last
 * `--max-age-days` (default 7) since rental medians don't move that fast.
 *
 * The agent is deterministic — no LLM calls — but each run hits Bridge for
 * a small bbox query (1mi/24mo). The Bridge rate limit is 5000/hr and
 * bridge-client throttles outgoing requests at 200ms intervals, so
 * concurrency above ~5 won't go faster, only risk 429s.
 *
 * Usage:
 *   pnpm tsx scripts/enrich-rent-comps.ts                        # full sweep, concurrency 5
 *   pnpm tsx scripts/enrich-rent-comps.ts --limit=100            # cap rows this run
 *   pnpm tsx scripts/enrich-rent-comps.ts --concurrency=3        # back off if you hit 429s
 *   pnpm tsx scripts/enrich-rent-comps.ts --max-age-days=14      # only refresh older than 14 days
 *   pnpm tsx scripts/enrich-rent-comps.ts --force                # refresh everything
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

type Candidate = { mlsId: string };

async function fetchCandidates(): Promise<Candidate[]> {
  // Listings with lat/lng whose latest rent-comps enrichment is older than
  // the staleness window — or has none at all. force=true returns every
  // listing with lat/lng.
  if (force) {
    return db.$queryRaw<Candidate[]>`
      SELECT "mlsId"
      FROM "Listing"
      WHERE "lat" IS NOT NULL AND "lng" IS NOT NULL
      ORDER BY "mlsId" ASC
    `;
  }
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
      AND (e.last_at IS NULL OR e.last_at < ${cutoff})
    ORDER BY l."mlsId" ASC
  `;
}

async function main() {
  const allCandidates = await fetchCandidates();
  const candidates = limit ? allCandidates.slice(0, limit) : allCandidates;
  console.log(
    `[rent-comps] candidates: ${candidates.length}${limit ? ` (limited from ${allCandidates.length})` : ""} concurrency=${concurrency} maxAgeDays=${maxAgeDays}${force ? " (force)" : ""}`,
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
