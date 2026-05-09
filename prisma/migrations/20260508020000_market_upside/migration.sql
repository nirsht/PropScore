-- Market Upside & Valuation: assessment delta + zoning under-utilization.
--
-- Adds:
--   - Listing.zoningDistrict / zoningMaxUnits / zoningFetchedAt
--   - Listing.assessedValueTotal (generated column)
--   - Score.assessmentDeltaScore / zoningUpsideScore / marketUpsideScore
--   - Neighborhood comp aggregate columns (medianAssessed*, medianSoldPrice*,
--     compSampleSize, compsUpdatedAt)
--   - ZoningRule curated lookup table
--   - zoning_polygon PostGIS table (raw, no Prisma model)
--
-- All new columns nullable / additive. The materialized view
-- `mv_listing_search` is rebuilt to expose marketUpsideScore for grid sorts.

-- ---------- Listing ----------
ALTER TABLE "Listing"
  ADD COLUMN "zoningDistrict"  TEXT,
  ADD COLUMN "zoningMaxUnits"  INTEGER,
  ADD COLUMN "zoningFetchedAt" TIMESTAMP(3);

CREATE INDEX "Listing_zoningDistrict_idx" ON "Listing" ("zoningDistrict");

ALTER TABLE "Listing"
  ADD COLUMN "assessedValueTotal" INTEGER GENERATED ALWAYS AS (
    COALESCE("assessorBuildingValue", 0) + COALESCE("assessorLandValue", 0)
  ) STORED;

-- ---------- Score ----------
ALTER TABLE "Score"
  ADD COLUMN "assessmentDeltaScore" DOUBLE PRECISION,
  ADD COLUMN "zoningUpsideScore"    DOUBLE PRECISION,
  ADD COLUMN "marketUpsideScore"    DOUBLE PRECISION;

CREATE INDEX "Score_marketUpsideScore_idx" ON "Score" ("marketUpsideScore" DESC);

-- ---------- Neighborhood comp aggregates ----------
ALTER TABLE "Neighborhood"
  ADD COLUMN "medianAssessedPerSqft"  DOUBLE PRECISION,
  ADD COLUMN "medianAssessedPerUnit"  DOUBLE PRECISION,
  ADD COLUMN "medianSoldPricePerSqft" DOUBLE PRECISION,
  ADD COLUMN "medianSoldPricePerUnit" DOUBLE PRECISION,
  ADD COLUMN "compSampleSize"         INTEGER,
  ADD COLUMN "compsUpdatedAt"         TIMESTAMP(3);

-- ---------- ZoningRule ----------
CREATE TABLE "ZoningRule" (
  "district"           TEXT PRIMARY KEY,
  "maxUnitsFixed"      INTEGER,
  "maxUnitsPerLotSqft" DOUBLE PRECISION,
  "notes"              TEXT
);

-- ---------- zoning_polygon (PostGIS) ----------
-- Bulk-loaded by `scripts/enrich-zoning.ts` from the SF Planning Zoning
-- Districts Socrata dataset. Listings are joined by ST_Intersects against
-- their lat/lng — no need to route through Assessor parcels.
CREATE TABLE "zoning_polygon" (
  "id"       BIGSERIAL PRIMARY KEY,
  "district" TEXT NOT NULL,
  "geom"     geography(MultiPolygon, 4326) NOT NULL,
  "fetchedAt" TIMESTAMP(3) NOT NULL DEFAULT NOW()
);

CREATE INDEX "zoning_polygon_geom_gist"     ON "zoning_polygon" USING GIST ("geom");
CREATE INDEX "zoning_polygon_district_idx"  ON "zoning_polygon" ("district");

-- ---------- mv_listing_search rebuild ----------
-- Add marketUpsideScore + zoningDistrict so the listings grid can sort/
-- filter on them. Keeps the COALESCE fallbacks for location/adu introduced
-- in v4 to avoid regressing pre-v4 Score rows.
DROP MATERIALIZED VIEW IF EXISTS "mv_listing_search";

CREATE MATERIALIZED VIEW "mv_listing_search" AS
SELECT
  l."mlsId",
  l."address",
  l."city",
  l."state",
  l."postalCode",
  l."lat",
  l."lng",
  l."geom",
  l."price",
  l."daysOnMls",
  l."postDate",
  l."listingUpdatedAt",
  l."status",
  l."propertyType",
  l."sqft",
  l."units",
  l."beds",
  l."baths",
  l."occupancy",
  l."yearBuilt",
  l."stories",
  l."effectiveSqft",
  l."effectiveLotSizeSqft",
  l."effectiveStories",
  COALESCE(l."assessorUnits", l."units")            AS "effectiveUnits",
  l."assessorBuildingSqft",
  l."assessorLotSqft",
  l."assessorUnits",
  l."assessorYearBuilt",
  l."assessorStories",
  l."assessorBuildingValue",
  l."assessorLandValue",
  l."assessedValueTotal",
  l."renovationLevel",
  l."renovationConfidence",
  l."aiStories",
  l."aiHasBasement",
  l."aiHasPenthouse",
  l."aduPotential",
  l."aduConfidence",
  l."extractedTotalMonthlyRent",
  l."extractedOccupancy",
  l."pricePerSqft",
  l."pricePerUnit",
  l."sqftPerUnit",
  l."hasSizeDiscrepancy",
  l."locationScore"       AS "listingLocationScore",
  l."zoningDistrict",
  l."zoningMaxUnits",
  s."densityScore",
  s."vacancyScore",
  s."motivationScore",
  COALESCE(s."locationScore", l."locationScore") AS "locationScore",
  COALESCE(
    s."aduScore",
    CASE l."aduPotential"
      WHEN 'HIGH'   THEN 100
      WHEN 'MEDIUM' THEN 55
      WHEN 'LOW'    THEN 15
      ELSE NULL
    END
  ) AS "aduScore",
  s."assessmentDeltaScore",
  s."zoningUpsideScore",
  s."marketUpsideScore",
  s."valueAddWeightedAvg",
  s."computedBy"   AS "scoreComputedBy",
  s."computedAt"   AS "scoreComputedAt"
FROM "Listing" l
LEFT JOIN "Score" s ON s."listingMlsId" = l."mlsId"
WHERE l."status" = 'Active';

CREATE UNIQUE INDEX "mv_listing_search_pk"                    ON "mv_listing_search" ("mlsId");
CREATE INDEX "mv_listing_search_value_add_idx"                ON "mv_listing_search" ("valueAddWeightedAvg" DESC NULLS LAST);
CREATE INDEX "mv_listing_search_price_idx"                    ON "mv_listing_search" ("price");
CREATE INDEX "mv_listing_search_pricePerSqft_idx"             ON "mv_listing_search" ("pricePerSqft");
CREATE INDEX "mv_listing_search_pricePerUnit_idx"             ON "mv_listing_search" ("pricePerUnit");
CREATE INDEX "mv_listing_search_propertyType_idx"             ON "mv_listing_search" ("propertyType");
CREATE INDEX "mv_listing_search_yearBuilt_idx"                ON "mv_listing_search" ("yearBuilt");
CREATE INDEX "mv_listing_search_renovationLevel_idx"          ON "mv_listing_search" ("renovationLevel");
CREATE INDEX "mv_listing_search_geom_gist"                    ON "mv_listing_search" USING GIST ("geom");
CREATE INDEX "mv_listing_search_address_trgm"                 ON "mv_listing_search" USING GIN ("address" gin_trgm_ops);
CREATE INDEX "mv_listing_search_hasSizeDiscrepancy_idx"       ON "mv_listing_search" ("hasSizeDiscrepancy") WHERE "hasSizeDiscrepancy" = TRUE;
CREATE INDEX "mv_listing_search_locationScore_idx"            ON "mv_listing_search" ("locationScore" DESC NULLS LAST);
CREATE INDEX "mv_listing_search_aduScore_idx"                 ON "mv_listing_search" ("aduScore" DESC NULLS LAST);
CREATE INDEX "mv_listing_search_marketUpsideScore_idx"        ON "mv_listing_search" ("marketUpsideScore" DESC NULLS LAST);
CREATE INDEX "mv_listing_search_zoningDistrict_idx"           ON "mv_listing_search" ("zoningDistrict");
