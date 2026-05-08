/**
 * One-off (re-runnable, idempotent): download SF "Analysis Neighborhoods"
 * GeoJSON from DataSF and upsert each polygon into the Neighborhood table.
 *
 * The boundary column is PostGIS geography(Polygon, 4326). Prisma can't
 * model PostGIS types directly, so we feed the GeoJSON to PostgreSQL via
 * `ST_GeomFromGeoJSON(...)::geography` in a $executeRaw call.
 *
 * MultiPolygon features (a few SF neighborhoods include offshore islands
 * or detached parcels) are stored as a single union polygon — adequate for
 * point-in-polygon listing lookups since ST_Intersects accepts both.
 *
 * Usage: pnpm seed:neighborhoods
 */
import { db } from "@/lib/db";
import { fetchAnalysisNeighborhoods } from "@/server/etl/datasf-client";

async function main() {
  console.log("[seed-neighborhoods] downloading DataSF Analysis Neighborhoods GeoJSON…");
  const fc = await fetchAnalysisNeighborhoods();
  console.log(`[seed-neighborhoods] received ${fc.features.length} features`);

  let upserted = 0;
  let skipped = 0;
  for (const feature of fc.features) {
    const name = String(feature.properties?.nhood ?? "").trim();
    if (!name) {
      skipped += 1;
      continue;
    }
    const geomJson = JSON.stringify(feature.geometry);

    // Upsert the row first (Prisma side), then set the PostGIS geometry
    // separately so we don't have to model the geography column.
    await db.neighborhood.upsert({
      where: { name },
      create: { name },
      update: {},
    });
    await db.$executeRaw`
      UPDATE "Neighborhood"
         SET "boundary" = ST_GeomFromGeoJSON(${geomJson})::geography
       WHERE "name" = ${name}
    `;
    upserted += 1;
  }

  // Sanity-check the GIST index is in place.
  const idx = await db.$queryRaw<Array<{ indexname: string }>>`
    SELECT indexname FROM pg_indexes
     WHERE tablename = 'Neighborhood' AND indexname = 'Neighborhood_boundary_gist'
  `;
  if (idx.length === 0) {
    console.warn(
      "[seed-neighborhoods] WARNING: Neighborhood_boundary_gist index missing — did you run `pnpm prisma migrate deploy`?",
    );
  }

  const total = await db.neighborhood.count();
  console.log(
    `[seed-neighborhoods] done — upserted=${upserted}, skipped=${skipped}, totalRows=${total}`,
  );
}

main()
  .catch((err) => {
    console.error("[seed-neighborhoods] failed:", err);
    process.exit(1);
  })
  .finally(() => db.$disconnect());
