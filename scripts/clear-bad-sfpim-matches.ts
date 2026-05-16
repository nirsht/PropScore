/**
 * One-shot: null out assessor fields for SF Listings whose currently-attached
 * parcel looks bad, then refresh the materialized view. Subsequent runs of
 * `pnpm tsx scripts/enrich-sfpim.ts` (no --force) will re-attempt those rows
 * with the new matcher.
 *
 *   pnpm tsx scripts/clear-bad-sfpim-matches.ts            # dry run, prints counts
 *   pnpm tsx scripts/clear-bad-sfpim-matches.ts --commit   # actually clears
 *
 * Heuristics (a row is "bad" if ANY apply):
 *   1. Listing street number doesn't appear (zero-pad-aware) in the matched
 *      assessor's property_location — direct substring-bug evidence.
 *   2. Unit listing (`address ~ '#'`) whose `assessorBuildingSqft > 2 × sqft` —
 *      the parent-building parcel was attached instead of the condo unit.
 *   3. `assessorBuildingSqft < sqft / 3` — sub-unit/garage attached to a
 *      multi-unit listing.
 *   4. No `raw.assessor` blob persisted (76% of historical rows) — we can't
 *      audit these without a re-fetch, so clear them to opt them back into
 *      the next enrich pass with the new matcher's strict scoring.
 */
import { db } from "@/lib/db";

const commit = process.argv.includes("--commit");

const HEURISTICS: { name: string; predicate: string }[] = [
  {
    name: "street-number-missing-from-assessor-loc",
    predicate: `
      substring("address" from '^\\s*(\\d+)') IS NOT NULL
      AND raw->'assessor'->>'property_location' IS NOT NULL
      AND (raw->'assessor'->>'property_location') !~
        ('(^|[^0-9])0*' || substring("address" from '^\\s*(\\d+)') || '([^0-9]|$)')
    `,
  },
  {
    name: "unit-listing-2x-oversized-parent-parcel",
    predicate: `
      "address" ~ '#'
      AND "sqft" IS NOT NULL AND "sqft" > 0
      AND "assessorBuildingSqft" > 2 * "sqft"
    `,
  },
  {
    name: "assessor-sub-third-of-listing-sqft",
    predicate: `
      "sqft" IS NOT NULL AND "sqft" > 0
      AND "assessorBuildingSqft" > 0
      AND "assessorBuildingSqft" < "sqft" / 3
    `,
  },
  {
    name: "no-raw-assessor-blob-persisted",
    predicate: `(raw->'assessor') IS NULL`,
  },
];

const baseFilter = `"city" = 'San Francisco' AND "blockLot" IS NOT NULL`;

async function main() {
  console.log(`[clear-bad] mode=${commit ? "COMMIT" : "DRY RUN"}\n`);

  for (const h of HEURISTICS) {
    const r = await db.$queryRawUnsafe<any[]>(`
      SELECT COUNT(*) AS n
      FROM "Listing"
      WHERE ${baseFilter} AND (${h.predicate})
    `);
    console.log(`  ${h.name}: ${r[0]!.n}`);
  }

  const unionPredicate = HEURISTICS.map((h) => `(${h.predicate})`).join(" OR ");
  const totalRows = await db.$queryRawUnsafe<any[]>(`
    SELECT COUNT(*) AS n FROM "Listing"
    WHERE ${baseFilter} AND (${unionPredicate})
  `);
  console.log(`\n  TOTAL DISTINCT rows to clear: ${totalRows[0]!.n}`);

  if (!commit) {
    console.log("\n[clear-bad] dry run — pass --commit to apply.");
    return;
  }

  const updated = await db.$executeRawUnsafe(`
    UPDATE "Listing"
    SET
      "blockLot" = NULL,
      "block" = NULL,
      "lot" = NULL,
      "assessorBuildingSqft" = NULL,
      "assessorLotSqft" = NULL,
      "assessorYearBuilt" = NULL,
      "assessorStories" = NULL,
      "assessorUnits" = NULL,
      "assessorRooms" = NULL,
      "assessorBedrooms" = NULL,
      "assessorBathrooms" = NULL,
      "assessorUseType" = NULL,
      "assessorConstructionType" = NULL,
      "assessorBasement" = NULL,
      "assessorBuildingValue" = NULL,
      "assessorLandValue" = NULL,
      "assessorFetchedAt" = NULL,
      "raw" = (raw - 'assessor' - 'assessorMatch')
    WHERE ${baseFilter} AND (${unionPredicate})
  `);
  console.log(`\n[clear-bad] cleared ${updated} rows.`);

  console.log("[clear-bad] refreshing materialized view…");
  await db.$executeRawUnsafe(`REFRESH MATERIALIZED VIEW CONCURRENTLY "mv_listing_search"`);
  console.log("[clear-bad] done. Run `pnpm tsx scripts/enrich-sfpim.ts` to re-match.");
}

main()
  .catch((err) => {
    console.error("[clear-bad] failed:", err);
    process.exit(1);
  })
  .finally(() => db.$disconnect());
