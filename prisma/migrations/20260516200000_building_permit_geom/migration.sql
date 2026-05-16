-- =========================================================================
-- Restore BuildingPermit.geom column + GiST index.
--
-- The original 20260508162758_feasibility migration declared this column
-- but it is missing from the production DB (likely lost during the
-- adu_split re-issue or an early partial apply — `prisma migrate status`
-- says applied, but information_schema.columns shows no geom). The permits
-- enricher writes to it via ST_SetSRID(ST_MakePoint(lng, lat), 4326), and
-- the radius-precedent query in phase 2 reads from it via ST_DWithin.
-- Without the column every block-fetch logs a 42703 and radius counts
-- silently fall back to 0.
--
-- IF NOT EXISTS guards keep this safe to re-apply on environments where
-- the column was correctly created the first time.
-- =========================================================================

ALTER TABLE "BuildingPermit"
  ADD COLUMN IF NOT EXISTS "geom" geography(Point, 4326);

CREATE INDEX IF NOT EXISTS "BuildingPermit_geom_gist"
  ON "BuildingPermit" USING GIST ("geom");

-- Backfill geom for any rows already in the table with lat/lng set.
UPDATE "BuildingPermit"
   SET "geom" = ST_SetSRID(ST_MakePoint("lng", "lat"), 4326)::geography
 WHERE "geom" IS NULL
   AND "lat" IS NOT NULL
   AND "lng" IS NOT NULL;
