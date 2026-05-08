-- Location Rating: neighborhood + walk score + combined location score.
--
-- Adds two new tables (Neighborhood + NeighborhoodCrimeStat) and four new
-- columns on Listing. The Neighborhood.boundary column is PostGIS
-- geography(Polygon, 4326), seeded by `pnpm seed:neighborhoods` from the
-- DataSF "Analysis Neighborhoods" GeoJSON. Crime stats are recomputed
-- nightly from DataSF dataset wg3w-h783 (post-2018 SFPD incidents).

-- ---------- Neighborhood ----------
CREATE TABLE "Neighborhood" (
  "name"              TEXT PRIMARY KEY,
  "crimeScore"        DOUBLE PRECISION,
  "weightedIncidents" DOUBLE PRECISION,
  "crimeUpdatedAt"    TIMESTAMP(3)
);

ALTER TABLE "Neighborhood"
  ADD COLUMN "boundary" geography(Polygon, 4326);

CREATE INDEX "Neighborhood_boundary_gist" ON "Neighborhood" USING GIST ("boundary");

-- ---------- NeighborhoodCrimeStat ----------
CREATE TABLE "NeighborhoodCrimeStat" (
  "neighborhood" TEXT         NOT NULL,
  "category"     TEXT         NOT NULL,
  "count"        INTEGER      NOT NULL,
  "windowStart"  TIMESTAMP(3) NOT NULL,
  "windowEnd"    TIMESTAMP(3) NOT NULL,

  PRIMARY KEY ("neighborhood", "category", "windowStart"),
  CONSTRAINT "NeighborhoodCrimeStat_neighborhood_fkey"
    FOREIGN KEY ("neighborhood") REFERENCES "Neighborhood"("name")
    ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE INDEX "NeighborhoodCrimeStat_neighborhood_idx"
  ON "NeighborhoodCrimeStat" ("neighborhood");

-- ---------- Listing additions ----------
ALTER TABLE "Listing"
  ADD COLUMN "neighborhood"           TEXT,
  ADD COLUMN "walkScore"              INTEGER,
  ADD COLUMN "walkScoreFetchedAt"     TIMESTAMP(3),
  ADD COLUMN "locationScore"          DOUBLE PRECISION,
  ADD COLUMN "locationScoreUpdatedAt" TIMESTAMP(3);

ALTER TABLE "Listing"
  ADD CONSTRAINT "Listing_neighborhood_fkey"
    FOREIGN KEY ("neighborhood") REFERENCES "Neighborhood"("name")
    ON DELETE SET NULL ON UPDATE CASCADE;

CREATE INDEX "Listing_neighborhood_idx" ON "Listing" ("neighborhood");
CREATE INDEX "Listing_locationScore_idx" ON "Listing" ("locationScore" DESC);
