/**
 * Nightly: fetch Walk Score for any listing missing one or whose cached
 * value is older than 90 days. Walk Score values are stable, and the free
 * tier is 5,000 calls/day — by skipping fresh listings we stay well under
 * the cap even with hundreds of new SF listings per week.
 *
 * Concurrency capped at 4 to be polite. On a 429 response or quota error
 * the script logs and exits 0 — partial progress is fine, the next run
 * will pick up where this one left off.
 *
 * Usage:
 *   pnpm refresh:walkscore           # process all stale/missing
 *   pnpm refresh:walkscore --max=10  # cap rows for testing
 */
import { db } from "@/lib/db";
import { env } from "@/lib/env";
import { fetchWalkScore } from "@/server/etl/walkscore-client";

const STALE_DAYS = 90;
const CONCURRENCY = 4;

async function main() {
  if (!env.WALKSCORE_API_KEY) {
    console.warn(
      "[refresh-walkscore] WALKSCORE_API_KEY not set — skipping. Add a key to enable Walk Score in the Location Rating.",
    );
    return;
  }

  const args = process.argv.slice(2);
  const maxArg = args.find((a) => a.startsWith("--max="));
  const max = maxArg ? Number(maxArg.split("=")[1]) : undefined;

  const staleCutoff = new Date(Date.now() - STALE_DAYS * 24 * 60 * 60 * 1000);

  const targets = await db.listing.findMany({
    where: {
      lat: { not: null },
      lng: { not: null },
      OR: [
        { walkScore: null },
        { walkScoreFetchedAt: null },
        { walkScoreFetchedAt: { lt: staleCutoff } },
      ],
    },
    select: {
      mlsId: true,
      address: true,
      city: true,
      state: true,
      postalCode: true,
      lat: true,
      lng: true,
    },
    orderBy: { walkScoreFetchedAt: { sort: "asc", nulls: "first" } },
    ...(max ? { take: max } : {}),
  });

  console.log(`[refresh-walkscore] candidates: ${targets.length}`);
  if (targets.length === 0) return;

  let ok = 0;
  let calculating = 0;
  let errored = 0;
  let stoppedEarly = false;

  // Simple bounded-concurrency runner. We bail early on rate-limit/quota.
  const queue = [...targets];
  await Promise.all(
    Array.from({ length: CONCURRENCY }, async () => {
      while (queue.length > 0 && !stoppedEarly) {
        const l = queue.shift();
        if (!l || l.lat == null || l.lng == null) continue;

        const fullAddress = [l.address, l.city, l.state, l.postalCode].filter(Boolean).join(", ");
        const result = await fetchWalkScore({
          lat: l.lat,
          lng: l.lng,
          address: fullAddress,
        });

        if (result.ok) {
          await db.listing.update({
            where: { mlsId: l.mlsId },
            data: { walkScore: result.data.walkScore, walkScoreFetchedAt: new Date() },
          });
          ok += 1;
        } else if (result.reason === "calculating") {
          // Walk Score will compute on its side; refresh next run.
          calculating += 1;
        } else if (result.reason === "rate_limit" || result.reason === "quota") {
          console.warn(
            `[refresh-walkscore] ${result.reason} — stopping; next run will continue. status=${result.status}`,
          );
          stoppedEarly = true;
        } else {
          errored += 1;
          if (errored <= 5) {
            console.warn(`[refresh-walkscore] error for ${l.mlsId}: reason=${result.reason} status=${result.status}`);
          }
        }
      }
    }),
  );

  console.log(
    `[refresh-walkscore] done — fetched=${ok}, calculating=${calculating}, errored=${errored}, stoppedEarly=${stoppedEarly}`,
  );
}

main()
  .catch((err) => {
    console.error("[refresh-walkscore] failed:", err);
    process.exit(1);
  })
  .finally(() => db.$disconnect());
