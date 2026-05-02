/**
 * Batch-run the building-vision agent on listings without an analysis yet.
 *
 * Photos aren't part of the initial Bridge sync (the `Media` field is
 * expensive and isn't in DEFAULT_SELECT), so this script first checks each
 * candidate's `raw.Media`:
 *  - cached: run vision directly
 *  - empty: probe Bridge for media via `fetchListingMedia`, persist into
 *           `raw.Media` so it's there for the drawer too, then run vision
 *  - still empty after probe: call `runBuildingVision` anyway so the agent
 *    writes a "no photos" record + sets `visionFetchedAt` — that way the
 *    same listing isn't retried on every nightly run.
 *
 * Usage:
 *   pnpm tsx scripts/enrich-vision.ts                   # full sweep
 *   pnpm tsx scripts/enrich-vision.ts --limit=5         # cap rows this run
 *   pnpm tsx scripts/enrich-vision.ts --force           # re-analyze even if done
 *   pnpm tsx scripts/enrich-vision.ts --missing-reno    # listings missing renovationLevel
 */
import type { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { runBuildingVision } from "@/server/agents/building-vision/agent";
import { fetchListingMedia, type BridgeMediaItem } from "@/server/etl/bridge-client";

const args = process.argv.slice(2);
const limitArg = args.find((a) => a.startsWith("--limit="));
const limit = limitArg ? Number(limitArg.split("=")[1]) : undefined;
const force = args.includes("--force");
const missingReno = args.includes("--missing-reno");

async function main() {
  const where = missingReno
    ? { renovationLevel: null }
    : force
      ? {}
      : { visionFetchedAt: null };

  const total = await db.listing.count({ where });
  const mode = missingReno ? " (missing-reno)" : force ? " (force)" : "";
  console.log(
    `[vision] candidates: ${total}${limit ? ` (limited to ${limit})` : ""}${mode}`,
  );

  let processed = 0;
  let analyzed = 0;
  let mediaFetched = 0;
  let noMedia = 0;
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
      try {
        const raw = (l.raw ?? {}) as Record<string, unknown>;
        let media = (raw.Media as BridgeMediaItem[] | undefined) ?? [];

        // Cache miss → probe Bridge once and persist back into raw.Media so
        // future runs (and the drawer) read from cache.
        if (!Array.isArray(media) || media.length === 0) {
          const result = await fetchListingMedia(l.mlsId);
          media = result.items;
          if (media.length > 0) {
            mediaFetched += 1;
            await db.listing.update({
              where: { mlsId: l.mlsId },
              data: {
                raw: { ...raw, Media: media } as Prisma.InputJsonValue,
              },
            });
          }
        }

        // Always invoke runBuildingVision — when media is empty the agent
        // writes a no-photos enrichment row and stamps visionFetchedAt, so
        // we don't retry this listing forever.
        const out = await runBuildingVision(l.mlsId, null);
        if (out.bestPhotoUrl) analyzed += 1;
        else if (!media || media.length === 0) noMedia += 1;
      } catch (err) {
        errored += 1;
        console.error(`[vision] mlsId=${l.mlsId}:`, err);
      }
    }

    cursor = batch[batch.length - 1]?.mlsId;
    console.log(
      `[vision] processed=${processed}/${total}, analyzed=${analyzed}, mediaFetched=${mediaFetched}, noMedia=${noMedia}, errored=${errored}`,
    );
  }

  console.log(`[vision] refreshing materialized view…`);
  await db.$executeRawUnsafe(
    `REFRESH MATERIALIZED VIEW CONCURRENTLY "mv_listing_search"`,
  );

  console.log(
    `[vision] done — processed=${processed}, analyzed=${analyzed}, mediaFetched=${mediaFetched}, noMedia=${noMedia}, errored=${errored}`,
  );
}

main()
  .catch((err) => {
    console.error("[vision] failed:", err);
    process.exit(1);
  })
  .finally(() => db.$disconnect());
