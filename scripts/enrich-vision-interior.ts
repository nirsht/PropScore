/**
 * Batch-run the interior-vision agent on listings that haven't been
 * analyzed yet (no AIEnrichment row with agentName="interior-vision"), or
 * — with flags — on a targeted subset.
 *
 * Interior vision is a SUPPLEMENT to building-vision (exterior). It writes a
 * full per-photo breakdown to AIEnrichment regardless, and only overwrites
 * Listing.renovationLevel when the interior verdict is higher-confidence than
 * the existing exterior verdict (or the exterior verdict is null). See
 * shouldAdoptInterior in the agent for the exact rule.
 *
 * Photos must already be cached in raw.Media (the exterior `enrich:vision`
 * stage primes this on first probe). If raw.Media is empty, this script
 * probes Bridge once and persists the result back so future runs and the
 * drawer share the cache.
 *
 * Usage:
 *   pnpm tsx scripts/enrich-vision-interior.ts                   # full sweep, concurrency 10
 *   pnpm tsx scripts/enrich-vision-interior.ts --limit=20        # pilot a small batch
 *   pnpm tsx scripts/enrich-vision-interior.ts --concurrency=5   # back off on rate limits
 *   pnpm tsx scripts/enrich-vision-interior.ts --force           # re-analyze every listing
 *   pnpm tsx scripts/enrich-vision-interior.ts --missing-reno    # only listings missing renovationLevel
 */
import type { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { runInteriorVision } from "@/server/agents/interior-vision/agent";
import { fetchListingMedia, type BridgeMediaItem } from "@/server/etl/bridge-client";
import { mapWithConcurrency } from "@/lib/concurrency";

const args = process.argv.slice(2);
const limitArg = args.find((a) => a.startsWith("--limit="));
const limit = limitArg ? Number(limitArg.split("=")[1]) : undefined;
const concurrencyArg = args.find((a) => a.startsWith("--concurrency="));
const concurrency = concurrencyArg
  ? Math.max(1, Math.min(25, Number(concurrencyArg.split("=")[1])))
  : 10;
const force = args.includes("--force");
const missingReno = args.includes("--missing-reno");

type Result = "analyzed" | "noMedia" | "noInteriors";

async function main() {
  const where: Prisma.ListingWhereInput = missingReno
    ? { renovationLevel: null }
    : force
      ? {}
      : { enrichments: { none: { agentName: "interior-vision" } } };

  const total = await db.listing.count({ where });
  const mode = missingReno ? " (missing-reno)" : force ? " (force)" : "";
  console.log(
    `[interior-vision] candidates: ${total}${limit ? ` (limited to ${limit})` : ""}${mode} concurrency=${concurrency}`,
  );

  let processed = 0;
  let analyzed = 0;
  let mediaFetched = 0;
  let noMedia = 0;
  let noInteriors = 0;
  let adopted = 0;
  let errored = 0;
  let cursor: string | undefined;
  const cap = limit ?? Number.POSITIVE_INFINITY;
  const BATCH = Math.max(25, concurrency);

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

    const started = Date.now();
    const results = await mapWithConcurrency(batch, concurrency, async (l): Promise<{ result: Result; mediaFetched: boolean; adopted: boolean }> => {
      const raw = (l.raw ?? {}) as Record<string, unknown>;
      let media = (raw.Media as BridgeMediaItem[] | undefined) ?? [];
      let didFetchMedia = false;

      if (!Array.isArray(media) || media.length === 0) {
        const probed = await fetchListingMedia(l.mlsId);
        media = probed.items;
        if (media.length > 0) {
          didFetchMedia = true;
          await db.listing.update({
            where: { mlsId: l.mlsId },
            data: {
              raw: { ...raw, Media: media } as Prisma.InputJsonValue,
            },
          });
        }
      }

      // Snapshot existing Reno BEFORE the agent runs so we can detect adoption.
      const before = await db.listing.findUnique({
        where: { mlsId: l.mlsId },
        select: { renovationLevel: true },
      });
      const beforeLevel = before?.renovationLevel ?? null;

      const out = await runInteriorVision(l.mlsId, null);

      const after = await db.listing.findUnique({
        where: { mlsId: l.mlsId },
        select: { renovationLevel: true },
      });
      const afterLevel = after?.renovationLevel ?? null;
      const wasAdopted = beforeLevel !== afterLevel && out.renovationLevel != null && afterLevel === out.renovationLevel;

      if (out.skipReason === "no_media") {
        return { result: "noMedia", mediaFetched: didFetchMedia, adopted: false };
      }
      if (out.skipReason === "no_interior_photos") {
        return { result: "noInteriors", mediaFetched: didFetchMedia, adopted: false };
      }
      return { result: "analyzed", mediaFetched: didFetchMedia, adopted: wasAdopted };
    });

    for (let i = 0; i < results.length; i++) {
      processed += 1;
      const r = results[i]!;
      if (r.status === "fulfilled") {
        if (r.value.mediaFetched) mediaFetched += 1;
        if (r.value.adopted) adopted += 1;
        if (r.value.result === "analyzed") analyzed += 1;
        else if (r.value.result === "noMedia") noMedia += 1;
        else if (r.value.result === "noInteriors") noInteriors += 1;
      } else {
        errored += 1;
        console.error(`[interior-vision] mlsId=${batch[i]!.mlsId}:`, r.reason);
      }
    }

    cursor = batch[batch.length - 1]?.mlsId;
    const dur = ((Date.now() - started) / 1000).toFixed(1);
    console.log(
      `[interior-vision] processed=${processed}/${total}, analyzed=${analyzed}, adopted=${adopted}, mediaFetched=${mediaFetched}, noMedia=${noMedia}, noInteriors=${noInteriors}, errored=${errored} (batch ${dur}s)`,
    );
  }

  console.log(`[interior-vision] refreshing materialized view…`);
  await db.$executeRawUnsafe(
    `REFRESH MATERIALIZED VIEW CONCURRENTLY "mv_listing_search"`,
  );

  console.log(
    `[interior-vision] done — processed=${processed}, analyzed=${analyzed}, adopted=${adopted}, mediaFetched=${mediaFetched}, noMedia=${noMedia}, noInteriors=${noInteriors}, errored=${errored}`,
  );
}

main()
  .catch((err) => {
    console.error("[interior-vision] failed:", err);
    process.exit(1);
  })
  .finally(() => db.$disconnect());
