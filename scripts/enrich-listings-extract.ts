/**
 * Batch-run the listing-extract agent on listings whose remarks haven't been
 * parsed yet. Runs the agent in parallel across the batch (default 25
 * concurrent OpenAI calls) since this script makes no rate-limited Bridge
 * requests — only OpenAI, which has tier-dependent RPM/TPM limits well
 * above 25 for any paid tier.
 *
 * Usage:
 *   pnpm tsx scripts/enrich-listings-extract.ts                 # full sweep, concurrency 25
 *   pnpm tsx scripts/enrich-listings-extract.ts --limit=20      # cap rows this run
 *   pnpm tsx scripts/enrich-listings-extract.ts --concurrency=5 # back off if you hit 429s
 *   pnpm tsx scripts/enrich-listings-extract.ts --force         # re-parse even if already done
 */
import { db } from "@/lib/db";
import { runListingExtract } from "@/server/agents/listing-extract/agent";

const args = process.argv.slice(2);
const limitArg = args.find((a) => a.startsWith("--limit="));
const limit = limitArg ? Number(limitArg.split("=")[1]) : undefined;
const concurrencyArg = args.find((a) => a.startsWith("--concurrency="));
const concurrency = concurrencyArg
  ? Math.max(1, Math.min(50, Number(concurrencyArg.split("=")[1])))
  : 25;
const force = args.includes("--force");

async function main() {
  const where = force ? {} : { extractFetchedAt: null };

  const total = await db.listing.count({ where });
  console.log(
    `[extract] candidates: ${total}${limit ? ` (limited to ${limit})` : ""}${force ? " (force)" : ""} concurrency=${concurrency}`,
  );

  let processed = 0;
  let parsed = 0;
  let errored = 0;
  let cursor: string | undefined;
  const cap = limit ?? Number.POSITIVE_INFINITY;
  const BATCH = concurrency;

  while (processed < cap) {
    const remaining = Math.min(BATCH, cap - processed);
    const batch = await db.listing.findMany({
      where,
      take: remaining,
      ...(cursor ? { skip: 1, cursor: { mlsId: cursor } } : {}),
      orderBy: { mlsId: "asc" },
      select: { mlsId: true },
    });
    if (batch.length === 0) break;

    // Fire the whole batch in parallel — Promise.allSettled so one failure
    // doesn't tank the rest. Each agent call writes its own AgentTrace +
    // Listing update, so parallel writes only conflict if two rows share an
    // mlsId (they don't — Prisma yields distinct rows from the cursor).
    const started = Date.now();
    const results = await Promise.allSettled(
      batch.map((l) => runListingExtract(l.mlsId, null)),
    );
    const dur = ((Date.now() - started) / 1000).toFixed(1);

    for (let i = 0; i < results.length; i++) {
      processed += 1;
      const r = results[i]!;
      if (r.status === "fulfilled") {
        parsed += 1;
      } else {
        errored += 1;
        console.error(`[extract] mlsId=${batch[i]!.mlsId}:`, r.reason);
      }
    }

    cursor = batch[batch.length - 1]?.mlsId;
    console.log(
      `[extract] processed=${processed}/${total}, parsed=${parsed}, errored=${errored} (batch ${dur}s)`,
    );
  }

  console.log(`[extract] refreshing materialized view…`);
  await db.$executeRawUnsafe(
    `REFRESH MATERIALIZED VIEW CONCURRENTLY "mv_listing_search"`,
  );

  console.log(
    `[extract] done — processed=${processed}, parsed=${parsed}, errored=${errored}`,
  );
}

main()
  .catch((err) => {
    console.error("[extract] failed:", err);
    process.exit(1);
  })
  .finally(() => db.$disconnect());
