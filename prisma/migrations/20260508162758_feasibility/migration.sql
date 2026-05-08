-- ADU/reconfiguration feasibility signals: SF Open Data ingestion + parcel
-- summary fields. See plan: ADU-FEASIBILITY (Building Permits + Land Use).
--
-- Two new SF datasets:
--   * Building Permits (i98e-djp9) — full rows in BuildingPermit table; per-
--     listing summary counts denormalized onto Listing for the score path.
--   * Land Use 2023 (fdfd-xptc) — joined to Listing.blockLot via mapblklot.
--
-- Assessor (wv5m-vpq2) was already integrated in 20260430000000_assessor_vision.

-- ---------- Listing additions ----------
ALTER TABLE "Listing"
  ADD COLUMN "landUseCategory"             TEXT,
  ADD COLUMN "landUseResUnits"             INTEGER,
  ADD COLUMN "landUseResSqft"              INTEGER,
  ADD COLUMN "landUseCommSqft"             INTEGER,
  ADD COLUMN "landUseFetchedAt"            TIMESTAMP(3),
  ADD COLUMN "permitsOwnParcelCount"       INTEGER,
  ADD COLUMN "permitsOwnParcelAduCount"    INTEGER,
  ADD COLUMN "permitsBlockAduRecentCount"  INTEGER,
  ADD COLUMN "permitsRadiusAduRecentCount" INTEGER,
  ADD COLUMN "latestAduPermitOnBlock"      JSONB,
  ADD COLUMN "permitsFetchedAt"            TIMESTAMP(3);

CREATE INDEX "Listing_landUseCategory_idx" ON "Listing" ("landUseCategory");

-- ---------- BuildingPermit ----------
CREATE TABLE "BuildingPermit" (
  "permitNumber"              TEXT          PRIMARY KEY,
  "blockLot"                  TEXT          NOT NULL,
  "block"                     TEXT          NOT NULL,
  "lot"                       TEXT          NOT NULL,
  "filedDate"                 TIMESTAMP(3),
  "issuedDate"                TIMESTAMP(3),
  "status"                    TEXT,
  "description"               TEXT,
  "aduFlag"                   BOOLEAN       NOT NULL DEFAULT FALSE,
  "aduKeyword"                BOOLEAN       NOT NULL DEFAULT FALSE,
  "existingUnits"             INTEGER,
  "proposedUnits"             INTEGER,
  "existingConstructionType"  TEXT,
  "proposedConstructionType"  TEXT,
  "existingUse"               TEXT,
  "proposedUse"               TEXT,
  "lat"                       DOUBLE PRECISION,
  "lng"                       DOUBLE PRECISION,
  "raw"                       JSONB         NOT NULL,
  "fetchedAt"                 TIMESTAMP(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX "BuildingPermit_blockLot_idx"   ON "BuildingPermit" ("blockLot");
CREATE INDEX "BuildingPermit_block_idx"      ON "BuildingPermit" ("block");
CREATE INDEX "BuildingPermit_filedDate_idx"  ON "BuildingPermit" ("filedDate");
CREATE INDEX "BuildingPermit_aduFlag_idx"    ON "BuildingPermit" ("aduFlag");
CREATE INDEX "BuildingPermit_aduKeyword_idx" ON "BuildingPermit" ("aduKeyword");

-- PostGIS point for radius-precedent queries (ST_DWithin against
-- Listing.geom). Generated as a regular column populated by the enrich
-- script after each upsert (matches the Listing.geom pattern).
ALTER TABLE "BuildingPermit"
  ADD COLUMN "geom" geography(Point, 4326);

CREATE INDEX "BuildingPermit_geom_gist" ON "BuildingPermit" USING GIST ("geom");
