/**
 * Batch-run the building-vision agent on listings that have photos
 * but no vision analysis yet.
 *
 * Usage:
 *   pnpm tsx scripts/enrich-vision.ts             # full sweep
 *   pnpm tsx scripts/enrich-vision.ts --limit=5   # cap rows this run
 *   pnpm tsx scripts/enrich-vision.ts --force     # re-analyze even if already done
 */
import { db } from "@/lib/db";
import { runBuildingVision } from "@/server/agents/building-vision/agent";

const args = process.argv.slice(2);
const limitArg = args.find((a) => a.startsWith("--limit="));
const limit = limitArg ? Number(limitArg.split("=")[1]) : undefined;
const force = args.includes("--force");

async function main() {
  const where = force ? {} : { visionFetchedAt: null };

  const total = await db.listing.count({ where });
  console.log(
    `[vision] candidates: ${total}${limit ? ` (limited to ${limit})` : ""}${force ? " (force)" : ""}`,
  );

  let processed = 0;
  let analyzed = 0;
  let errored = 0;
  let cursor: string | undefined;
  const cap = limit ?? Number.POSITIVE_INFINITY;
  const BATCH = 25;

  while (processed < cap) {
    const remaining = Math.min(BATCH, cap - processed);
    const batch = await db.listing.findMany({
      where,
      take: remaining,
      ...(cursor ? { skip: 1, cursor: { mlsId: cursor } } : {}),
      orderBy: { mlsId: "asc" },
      select: { mlsId: true, raw: true },
    });
    if (batch.length === 0) break;

    for (const l of batch) {
      processed += 1;
      const media = (l.raw as { Media?: unknown[] } | null)?.Media;
      if (!Array.isArray(media) || media.length === 0) continue;

      try {
        const out = await runBuildingVision(l.mlsId, null);
        if (out.bestPhotoUrl) analyzed += 1;
      } catch (err) {
        errored += 1;
        console.error(`[vision] mlsId=${l.mlsId}:`, err);
      }
    }

    cursor = batch[batch.length - 1]?.mlsId;
    console.log(
      `[vision] processed=${processed}/${total}, analyzed=${analyzed}, errored=${errored}`,
    );
  }

  console.log(`[vision] refreshing materialized view…`);
  await db.$executeRawUnsafe(
    `REFRESH MATERIALIZED VIEW CONCURRENTLY "mv_listing_search"`,
  );

  console.log(
    `[vision] done — processed=${processed}, analyzed=${analyzed}, errored=${errored}`,
  );
}

main()
  .catch((err) => {
    console.error("[vision] failed:", err);
    process.exit(1);
  })
  .finally(() => db.$disconnect());
