/**
 * Nightly: pull crime aggregates for the last 12 months from DataSF (one
 * SoQL `$group` request, no pagination), then percentile-rank neighborhoods
 * to produce a 0–100 safety score where 100 = safest.
 *
 * Replaces the entire NeighborhoodCrimeStat table — the rolling-12-month
 * window slides forward each night, so prior-window rows would otherwise
 * accumulate forever and skew aggregates. The aggregate is small (~120
 * rows: 41 neighborhoods × 3 categories) so wholesale replacement is cheap.
 *
 * Usage: pnpm refresh:crime
 */
import { db } from "@/lib/db";
import { fetchCrimeAggregates } from "@/server/etl/datasf-client";
import { percentileRankCrimeScores } from "@/server/etl/scoring/location";

const WINDOW_DAYS = 365;

async function main() {
  const now = new Date();
  const windowStart = new Date(now.getTime() - WINDOW_DAYS * 24 * 60 * 60 * 1000);
  console.log(
    `[refresh-crime] window: ${windowStart.toISOString()} … ${now.toISOString()}`,
  );

  const stats = await fetchCrimeAggregates(windowStart);
  console.log(`[refresh-crime] received ${stats.length} aggregated rows from DataSF`);

  // Filter to neighborhoods that exist in our table — DataSF occasionally
  // emits names like "Lincoln Park / Ft. Miley" that don't appear in the
  // Analysis Neighborhoods polygon set. Those would FK-fail on insert.
  const known = new Set((await db.neighborhood.findMany({ select: { name: true } })).map((n) => n.name));
  const filtered = stats.filter((s) => known.has(s.neighborhood));
  const dropped = stats.length - filtered.length;
  if (dropped > 0) {
    const unknown = [...new Set(stats.filter((s) => !known.has(s.neighborhood)).map((s) => s.neighborhood))];
    console.log(`[refresh-crime] dropping ${dropped} rows from ${unknown.length} unknown neighborhoods: ${unknown.join(", ")}`);
  }

  // Replace the whole stat table for this window.
  await db.$transaction([
    db.neighborhoodCrimeStat.deleteMany({}),
    db.neighborhoodCrimeStat.createMany({
      data: filtered.map((s) => ({
        neighborhood: s.neighborhood,
        category: s.category,
        count: s.count,
        windowStart,
        windowEnd: now,
      })),
      skipDuplicates: true,
    }),
  ]);

  // Recompute percentile-rank crime scores across all neighborhoods.
  const ranks = percentileRankCrimeScores(filtered);
  let updated = 0;
  for (const [name, { crimeScore, weightedIncidents }] of ranks) {
    await db.neighborhood.update({
      where: { name },
      data: {
        crimeScore,
        weightedIncidents,
        crimeUpdatedAt: now,
      },
    });
    updated += 1;
  }

  // Neighborhoods with zero matching incidents in the window — they don't
  // appear in `ranks` at all. Mark them as "safest" (score 100) and zero
  // their weighted count, otherwise the UI would show "no data" for the
  // quietest neighborhoods.
  const zeroIncident = [...known].filter((n) => !ranks.has(n));
  if (zeroIncident.length > 0) {
    await db.neighborhood.updateMany({
      where: { name: { in: zeroIncident } },
      data: { crimeScore: 100, weightedIncidents: 0, crimeUpdatedAt: now },
    });
    console.log(`[refresh-crime] zero-incident neighborhoods scored 100: ${zeroIncident.join(", ")}`);
  }

  console.log(
    `[refresh-crime] done — neighborhoodsScored=${updated + zeroIncident.length}, statsRows=${filtered.length}`,
  );
}

main()
  .catch((err) => {
    console.error("[refresh-crime] failed:", err);
    process.exit(1);
  })
  .finally(() => db.$disconnect());
