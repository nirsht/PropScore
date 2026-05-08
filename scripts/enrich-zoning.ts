/**
 * Enrich every SF Listing with its base zoning district and (where the
 * curated `ZoningRule` has a static rule) the max-allowed unit count.
 *
 * Two-phase script:
 *   1. If `zoning_polygon` is empty or its newest row is older than 90 days,
 *      bulk-refresh from the Socrata GeoJSON dataset (resource 8br2-hhp3).
 *   2. For each listing missing `zoningFetchedAt` (or all when `--force`),
 *      do a PostGIS ST_Intersects join from the listing's lat/lng to the
 *      polygon table, then resolve `zoningMaxUnits` from `ZoningRule`.
 *
 * Idempotent + resumable, mirrors the shape of `scripts/enrich-sfpim.ts`.
 *
 * Usage:
 *   pnpm tsx scripts/enrich-zoning.ts                 # full sweep, concurrency 10
 *   pnpm tsx scripts/enrich-zoning.ts --limit=50      # cap rows this run
 *   pnpm tsx scripts/enrich-zoning.ts --concurrency=5 # back off
 *   pnpm tsx scripts/enrich-zoning.ts --force         # re-fetch even if populated
 *   pnpm tsx scripts/enrich-zoning.ts --refresh-polygons  # force polygon refresh
 */
import { db } from "@/lib/db";
import { fetchZoningDistricts, readDistrict } from "@/server/etl/zoning-client";
import { mapWithConcurrency } from "@/lib/concurrency";

const args = process.argv.slice(2);
const limitArg = args.find((a) => a.startsWith("--limit="));
const limit = limitArg ? Number(limitArg.split("=")[1]) : undefined;
const concurrencyArg = args.find((a) => a.startsWith("--concurrency="));
const concurrency = concurrencyArg
  ? Math.max(1, Math.min(20, Number(concurrencyArg.split("=")[1])))
  : 10;
const force = args.includes("--force");
const refreshPolygonsFlag = args.includes("--refresh-polygons");

const POLYGON_TTL_DAYS = 90;

async function shouldRefreshPolygons(): Promise<boolean> {
  if (refreshPolygonsFlag) return true;
  const rows = await db.$queryRaw<Array<{ count: bigint; newest: Date | null }>>`
    SELECT COUNT(*)::bigint AS count, MAX("fetchedAt") AS newest FROM "zoning_polygon"
  `;
  const row = rows[0];
  if (!row || Number(row.count) === 0) return true;
  const newest = row.newest;
  if (!newest) return true;
  const ageMs = Date.now() - newest.getTime();
  return ageMs > POLYGON_TTL_DAYS * 24 * 60 * 60 * 1000;
}

async function refreshPolygons() {
  console.log("[enrich-zoning] downloading SF Planning Zoning Districts GeoJSON…");
  const fc = await fetchZoningDistricts();
  console.log(`[enrich-zoning] received ${fc.features.length} features`);

  // Wholesale replace — districts change rarely and the table is small.
  await db.$executeRawUnsafe(`TRUNCATE TABLE "zoning_polygon"`);

  let inserted = 0;
  let skipped = 0;
  for (const f of fc.features) {
    const district = readDistrict(f);
    if (!district) {
      skipped += 1;
      continue;
    }
    // Coerce to MultiPolygon so the PostGIS column type is consistent.
    const geomJson = JSON.stringify(
      f.geometry.type === "MultiPolygon"
        ? f.geometry
        : { type: "MultiPolygon", coordinates: [f.geometry.coordinates] },
    );
    await db.$executeRaw`
      INSERT INTO "zoning_polygon" ("district", "geom")
      VALUES (${district}, ST_GeomFromGeoJSON(${geomJson})::geography)
    `;
    inserted += 1;
  }
  console.log(`[enrich-zoning] polygons refreshed — inserted=${inserted}, skipped=${skipped}`);
}

type ZoningRuleRow = {
  district: string;
  maxUnitsFixed: number | null;
  maxUnitsPerLotSqft: number | null;
};

async function loadZoningRules(): Promise<Map<string, ZoningRuleRow>> {
  const rules = await db.zoningRule.findMany();
  const map = new Map<string, ZoningRuleRow>();
  for (const r of rules) {
    map.set(r.district, {
      district: r.district,
      maxUnitsFixed: r.maxUnitsFixed,
      maxUnitsPerLotSqft: r.maxUnitsPerLotSqft,
    });
  }
  return map;
}

function resolveMaxUnits(
  rule: ZoningRuleRow | undefined,
  effectiveLotSizeSqft: number | null,
): number | null {
  if (!rule) return null;
  if (rule.maxUnitsFixed != null) return rule.maxUnitsFixed;
  if (rule.maxUnitsPerLotSqft != null && effectiveLotSizeSqft != null && effectiveLotSizeSqft > 0) {
    return Math.floor(effectiveLotSizeSqft / rule.maxUnitsPerLotSqft);
  }
  return null;
}

async function main() {
  if (await shouldRefreshPolygons()) {
    await refreshPolygons();
  } else {
    console.log("[enrich-zoning] polygon table is fresh — skipping refresh");
  }

  const rules = await loadZoningRules();
  console.log(`[enrich-zoning] loaded ${rules.size} zoning rules`);

  const where = {
    city: "San Francisco",
    lat: { not: null },
    lng: { not: null },
    ...(force ? {} : { zoningFetchedAt: null }),
  } as const;

  const total = await db.listing.count({ where });
  console.log(
    `[enrich-zoning] candidates: ${total}${limit ? ` (limited to ${limit})` : ""}${force ? " (force)" : ""} concurrency=${concurrency}`,
  );

  let processed = 0;
  let matched = 0;
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
        lat: true,
        lng: true,
        lotSizeSqft: true,
        assessorLotSqft: true,
      },
    });
    if (batch.length === 0) break;

    const started = Date.now();
    const results = await mapWithConcurrency(batch, concurrency, async (l) => {
      if (l.lat == null || l.lng == null) {
        await db.listing.update({
          where: { mlsId: l.mlsId },
          data: { zoningFetchedAt: new Date() },
        });
        return "skipped" as const;
      }
      // Point-in-polygon against zoning_polygon. Returns the smallest-area
      // matching polygon to disambiguate overlapping district records.
      const rows = await db.$queryRaw<Array<{ district: string }>>`
        SELECT "district"
          FROM "zoning_polygon"
         WHERE ST_Intersects(ST_SetSRID(ST_MakePoint(${l.lng}, ${l.lat}), 4326)::geography, "geom")
         ORDER BY ST_Area("geom") ASC
         LIMIT 1
      `;
      const district = rows[0]?.district ?? null;
      if (!district) {
        await db.listing.update({
          where: { mlsId: l.mlsId },
          data: { zoningFetchedAt: new Date() },
        });
        return "skipped" as const;
      }

      const effectiveLot = l.assessorLotSqft ?? l.lotSizeSqft ?? null;
      const maxUnits = resolveMaxUnits(rules.get(district), effectiveLot);

      await db.listing.update({
        where: { mlsId: l.mlsId },
        data: {
          zoningDistrict: district,
          zoningMaxUnits: maxUnits,
          zoningFetchedAt: new Date(),
        },
      });
      return "matched" as const;
    });

    for (let i = 0; i < results.length; i++) {
      processed += 1;
      const r = results[i]!;
      if (r.status === "fulfilled") {
        if (r.value === "matched") matched += 1;
        else skipped += 1;
      } else {
        errored += 1;
        console.error(`[enrich-zoning] mlsId=${batch[i]!.mlsId}:`, r.reason);
      }
    }

    cursor = batch[batch.length - 1]?.mlsId;
    const dur = ((Date.now() - started) / 1000).toFixed(1);
    console.log(
      `[enrich-zoning] processed=${processed}/${total}, matched=${matched}, skipped=${skipped}, errored=${errored} (batch ${dur}s)`,
    );
  }

  console.log(`[enrich-zoning] refreshing materialized view…`);
  await db.$executeRawUnsafe(
    `REFRESH MATERIALIZED VIEW CONCURRENTLY "mv_listing_search"`,
  );

  console.log(
    `[enrich-zoning] done — processed=${processed}, matched=${matched}, skipped=${skipped}, errored=${errored}`,
  );
}

main()
  .catch((err) => {
    console.error("[enrich-zoning] failed:", err);
    process.exit(1);
  })
  .finally(() => db.$disconnect());
