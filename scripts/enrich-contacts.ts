/**
 * Enrich every active SF Listing with the listing-agent + brokerage contact
 * details from the RentCast API. Bridge `sfar` (IDX) strips agent
 * phone/email, so this is the source until/unless we get a Bridge VOW feed.
 * Idempotent + resumable: skips listings whose ListingContact row is
 * younger than the refresh window (see contact-enrichment.ts).
 *
 * Usage:
 *   pnpm tsx scripts/enrich-contacts.ts                  # full sweep, concurrency 5
 *   pnpm tsx scripts/enrich-contacts.ts --limit=20       # cap rows this run
 *   pnpm tsx scripts/enrich-contacts.ts --concurrency=3  # back off
 *   pnpm tsx scripts/enrich-contacts.ts --force          # re-fetch even if fresh
 */
import { db } from "@/lib/db";
import { mapWithConcurrency } from "@/lib/concurrency";
import { enrichListingContact } from "@/server/etl/contact-enrichment";

const args = process.argv.slice(2);
const limitArg = args.find((a) => a.startsWith("--limit="));
const limit = limitArg ? Number(limitArg.split("=")[1]) : undefined;
const concurrencyArg = args.find((a) => a.startsWith("--concurrency="));
const concurrency = concurrencyArg
  ? Math.max(1, Math.min(10, Number(concurrencyArg.split("=")[1])))
  : 5;
const force = args.includes("--force");

async function main() {
  if (!process.env.RENTCAST_API_KEY) {
    console.error(
      "[contacts] RENTCAST_API_KEY missing. Sign up at https://www.rentcast.io/api and set it in .env.",
    );
    process.exit(1);
  }

  // Active listings only — there's no point spending RentCast credits on
  // sold/expired records the user can't act on.
  const where = { status: "Active" as const };
  const total = await db.listing.count({ where });
  console.log(
    `[contacts] candidates: ${total}${limit ? ` (limited to ${limit})` : ""}${force ? " (force)" : ""} concurrency=${concurrency}`,
  );

  let processed = 0;
  let hits = 0;
  let misses = 0;
  let skipped = 0;
  let errored = 0;
  let cursor: string | undefined;
  const cap = limit ?? Number.POSITIVE_INFINITY;
  const BATCH = 100;

  while (processed < cap) {
    const remaining = Math.min(BATCH, cap - processed);
    const batch = await db.listing.findMany({
      where,
      take: remaining,
      ...(cursor ? { skip: 1, cursor: { mlsId: cursor } } : {}),
      orderBy: { mlsId: "asc" },
      select: {
        mlsId: true,
        address: true,
        city: true,
        state: true,
        postalCode: true,
      },
    });
    if (batch.length === 0) break;

    const started = Date.now();
    const results = await mapWithConcurrency(batch, concurrency, (l) =>
      enrichListingContact(l, { force }),
    );

    for (const settled of results) {
      if (settled.status === "rejected") {
        errored += 1;
        continue;
      }
      switch (settled.value.status) {
        case "hit":
          hits += 1;
          break;
        case "miss":
          misses += 1;
          break;
        case "skipped":
          skipped += 1;
          break;
        case "error":
          errored += 1;
          break;
      }
    }

    processed += batch.length;
    cursor = batch[batch.length - 1]?.mlsId;
    const dur = ((Date.now() - started) / 1000).toFixed(1);
    console.log(
      `[contacts] processed=${processed}/${total} hit=${hits} miss=${misses} skip=${skipped} err=${errored} (+${batch.length} in ${dur}s)`,
    );
  }

  console.log(
    `[contacts] done. hit=${hits} miss=${misses} skip=${skipped} err=${errored} total=${processed}`,
  );
  await db.$disconnect();
}

main().catch(async (err) => {
  console.error("[contacts] failed:", err);
  await db.$disconnect();
  process.exit(1);
});
