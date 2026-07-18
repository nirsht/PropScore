-- =========================================================================
-- LocationCalibration: user-pinned "true" location score at a physical point.
--
-- Anchored to lat/lng (not an MLS id) so a calibration survives listing churn.
-- An exact calibration hard-overrides that address's location score; nearby
-- listings within ~0.3mi get a distance-decaying nudge (blendCalibration in
-- src/server/etl/scoring/location.ts). `pointKey` (rounded lat/lng) makes
-- re-calibrating the same spot an upsert.
--
-- Additive and idempotent (IF NOT EXISTS guards) — safe on the shared prod DB.
-- The PostGIS `geom` column + GiST index mirror the BuildingPermit.geom
-- pattern and back the ST_DWithin radius query.
-- =========================================================================

CREATE TABLE IF NOT EXISTS "LocationCalibration" (
  "id"              TEXT             NOT NULL,
  "lat"             DOUBLE PRECISION NOT NULL,
  "lng"             DOUBLE PRECISION NOT NULL,
  "pointKey"        TEXT             NOT NULL,
  "calibratedScore" DOUBLE PRECISION NOT NULL,
  "label"           TEXT,
  "listingMlsId"    TEXT,
  "note"            TEXT,
  "createdBy"       TEXT,
  "createdAt"       TIMESTAMP(3)     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"       TIMESTAMP(3)     NOT NULL,

  CONSTRAINT "LocationCalibration_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "LocationCalibration_pointKey_key"
  ON "LocationCalibration" ("pointKey");

CREATE INDEX IF NOT EXISTS "LocationCalibration_listingMlsId_idx"
  ON "LocationCalibration" ("listingMlsId");

-- PostGIS geography(Point,4326) column + GiST index (queried via $queryRaw).
ALTER TABLE "LocationCalibration"
  ADD COLUMN IF NOT EXISTS "geom" geography(Point, 4326);

CREATE INDEX IF NOT EXISTS "LocationCalibration_geom_gist"
  ON "LocationCalibration" USING GIST ("geom");
