/**
 * Nightly: recompute per-neighborhood comp medians used by the Market
 * Upside / assessment-delta scoring module.
 *
 * Two cohorts per neighborhood:
 *   - **Sold prices**: status IN ('Sold','Closed') with `postDate` in the
 *     last 24 months. SF small-multifamily turnover is thin; older sales
 *     mislead in this market, so we don't widen the window.
 *   - **Assessed values**: every listing with both an assessor total
 *     (improvement + land) and a basis (sqft or units). Wider sample is
 *     fine here because the comparison is within-cohort.
 *
 * For both cohorts we compute medians on $/effectiveSqft and $/effectiveUnits
 * via `percentile_cont(0.5) WITHIN GROUP`, grouped by neighborhood.
 *
 * Sparsity guard: when n < MIN_SAMPLE for a neighborhood, all medians for
 * that neighborhood are written as null. The scoring module returns null
 * in that case so the listing's value-add average is unaffected.
 *
 * Wholesale replacement of the aggregate columns; matches the shape of
 * `scripts/refresh-crime.ts`.
 *
 * Usage: pnpm tsx scripts/refresh-neighborhood-comps.ts
 */
import { db } from "@/lib/db";

const SOLD_WINDOW_MONTHS = 24;
const MIN_SAMPLE = 5;

type AggRow = {
  neighborhood: string;
  median_assessed_per_sqft: number | null;
  median_assessed_per_unit: number | null;
  median_sold_price_per_sqft: number | null;
  median_sold_price_per_unit: number | null;
  sample_size: number;
};

async function main() {
  const now = new Date();
  console.log(
    `[refresh-neighborhood-comps] computing medians (sold window = ${SOLD_WINDOW_MONTHS}mo, min sample = ${MIN_SAMPLE})…`,
  );

  // Single CTE-driven query: sold-cohort medians joined with assessed-cohort
  // medians joined with the larger sample-size of the two (so the sparsity
  // guard fires when EITHER cohort is too thin to be useful).
  const rows = await db.$queryRaw<AggRow[]>`
    WITH sold AS (
      SELECT
        l."neighborhood" AS neighborhood,
        percentile_cont(0.5) WITHIN GROUP (ORDER BY l."pricePerSqft") AS median_per_sqft,
        percentile_cont(0.5) WITHIN GROUP (ORDER BY l."pricePerUnit") AS median_per_unit,
        COUNT(*) AS n
      FROM "Listing" l
      WHERE l."neighborhood" IS NOT NULL
        AND l."status" IN ('Sold', 'Closed')
        AND l."postDate" > NOW() - (${SOLD_WINDOW_MONTHS}::int * INTERVAL '1 month')
        AND (l."pricePerSqft" IS NOT NULL OR l."pricePerUnit" IS NOT NULL)
      GROUP BY l."neighborhood"
    ),
    assessed AS (
      SELECT
        l."neighborhood" AS neighborhood,
        percentile_cont(0.5) WITHIN GROUP (
          ORDER BY (l."assessedValueTotal"::float / NULLIF(l."effectiveSqft", 0))
        ) AS median_per_sqft,
        percentile_cont(0.5) WITHIN GROUP (
          ORDER BY (l."assessedValueTotal"::float / NULLIF(COALESCE(l."assessorUnits", l."units"), 0))
        ) AS median_per_unit,
        COUNT(*) AS n
      FROM "Listing" l
      WHERE l."neighborhood" IS NOT NULL
        AND l."assessedValueTotal" IS NOT NULL
        AND l."assessedValueTotal" > 0
        AND (l."effectiveSqft" IS NOT NULL OR COALESCE(l."assessorUnits", l."units") IS NOT NULL)
      GROUP BY l."neighborhood"
    )
    SELECT
      n.name AS neighborhood,
      a.median_per_sqft AS median_assessed_per_sqft,
      a.median_per_unit AS median_assessed_per_unit,
      s.median_per_sqft AS median_sold_price_per_sqft,
      s.median_per_unit AS median_sold_price_per_unit,
      GREATEST(COALESCE(a.n, 0), COALESCE(s.n, 0))::int AS sample_size
    FROM "Neighborhood" n
    LEFT JOIN sold     s ON s.neighborhood = n.name
    LEFT JOIN assessed a ON a.neighborhood = n.name
  `;

  console.log(`[refresh-neighborhood-comps] ${rows.length} neighborhoods scanned`);

  let written = 0;
  let zeroed = 0;
  await Promise.all(
    rows.map(async (r) => {
      const sparse = r.sample_size < MIN_SAMPLE;
      const data = {
        medianAssessedPerSqft: sparse ? null : r.median_assessed_per_sqft,
        medianAssessedPerUnit: sparse ? null : r.median_assessed_per_unit,
        medianSoldPricePerSqft: sparse ? null : r.median_sold_price_per_sqft,
        medianSoldPricePerUnit: sparse ? null : r.median_sold_price_per_unit,
        compSampleSize: r.sample_size,
        compsUpdatedAt: now,
      };
      await db.neighborhood.update({ where: { name: r.neighborhood }, data });
      if (sparse) zeroed += 1;
      else written += 1;
    }),
  );

  console.log(
    `[refresh-neighborhood-comps] done — withMedians=${written}, sparseNulled=${zeroed}`,
  );
}

main()
  .catch((err) => {
    console.error("[refresh-neighborhood-comps] failed:", err);
    process.exit(1);
  })
  .finally(() => db.$disconnect());
