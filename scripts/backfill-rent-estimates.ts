import { db } from "@/lib/db";
import { runListingExtract } from "@/server/agents/listing-extract/agent";

/**
 * Re-runs `listing-extract` for any listing that already has an extracted
 * unit mix but no `aiRentEstimate` yet. Use this once after the migration
 * adding the `aiRentEstimate` column has been deployed, to backfill the
 * estimate so the drawer's Rent roll row labels switch from "AI estimate
 * pending" to actual numbers.
 *
 * Usage:
 *   pnpm tsx --env-file=.env scripts/backfill-rent-estimates.ts                       # all
 *   pnpm tsx --env-file=.env scripts/backfill-rent-estimates.ts --limit=5             # smoke test
 *   pnpm tsx --env-file=.env scripts/backfill-rent-estimates.ts --concurrency=10      # bump fan-out
 *
 * Concurrency defaults to 5 (each worker holds 1–2 DB connections during a
 * call; 5 is well under Render's pool ceiling and keeps OpenAI happy).
 * Re-running is safe — it skips rows that already have an estimate.
 */
async function main() {
  const limitArg = process.argv.find((a) => a.startsWith("--limit="));
  const limit = limitArg ? Number(limitArg.split("=")[1]) : null;
  const concurrencyArg = process.argv.find((a) =>
    a.startsWith("--concurrency="),
  );
  const concurrency = Math.max(
    1,
    concurrencyArg ? Number(concurrencyArg.split("=")[1]) : 5,
  );

  // CASE forces evaluation order — without it Postgres can call
  // jsonb_array_length on rows where extractedUnitMix is JSON-null/scalar
  // and bail with 22023 ("cannot get array length of a scalar").
  // Picks up rows missing EITHER AI rent field so the same script handles
  // first-pass backfill and any later schema additions.
  const targets = await db.$queryRawUnsafe<
    Array<{ mlsId: string; address: string }>
  >(
    `SELECT "mlsId", address
     FROM "Listing"
     WHERE ("aiRentEstimate" IS NULL OR "postRenovationRentEstimate" IS NULL)
       AND CASE
             WHEN jsonb_typeof("extractedUnitMix") = 'array'
               THEN jsonb_array_length("extractedUnitMix") > 0
             ELSE false
           END
     ORDER BY price DESC
     ${limit ? `LIMIT ${limit}` : ""}`,
  );

  console.log(
    `Backfilling AI rent estimates for ${targets.length} listings (concurrency=${concurrency})${
      limit ? `, limited to ${limit}` : ""
    }...`,
  );

  let ok = 0;
  let failed = 0;
  let nextIndex = 0;
  const total = targets.length;

  async function worker() {
    while (true) {
      const i = nextIndex++;
      if (i >= total) return;
      const t = targets[i]!;
      const tag = `[${i + 1}/${total}] ${t.mlsId}`;
      try {
        await runListingExtract(t.mlsId, null);
        ok++;
        console.log(`${tag} ✓ ${t.address}`);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        console.error(`${tag} ✗ ${msg}`);
        failed++;
      }
    }
  }

  await Promise.all(
    Array.from({ length: Math.min(concurrency, total) }, () => worker()),
  );

  console.log(`\nDone. ok=${ok}, failed=${failed}`);
  await db.$disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
