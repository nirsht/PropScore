-- DataSF "Analysis Neighborhoods" features are all MultiPolygons (a few
-- include offshore islands or detached parcels), so the original
-- `geography(Polygon, 4326)` column type rejected every insert with
-- "Geometry type (MultiPolygon) does not match column type (Polygon)".
-- Switch to MultiPolygon. The GIST index survives the ALTER.

ALTER TABLE "Neighborhood"
  ALTER COLUMN "boundary" TYPE geography(MultiPolygon, 4326)
  USING "boundary"::geography(MultiPolygon, 4326);
