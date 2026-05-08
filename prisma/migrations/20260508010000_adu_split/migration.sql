-- =========================================================================
-- ADU feasibility split: replace single LOW/MEDIUM/HIGH `aduPotential` with
-- two parallel 0–100 scores — `detachedAduScore` (vacant-yard ADU) and
-- `convertedAduScore` (repurpose basement/garage). Adds `convertedAduSource`
-- and a numeric `assessorBasementSqft` to drive the converted score.
-- =========================================================================

-- Drop the materialized view first; it references aduPotential / aduConfidence.
DROP MATERIALIZED VIEW IF EXISTS "mv_listing_search";

-- ---------- Drop old columns ----------
ALTER TABLE "Listing"
  DROP COLUMN IF EXISTS "aduPotential",
  DROP COLUMN IF EXISTS "aduConfidence",
  DROP COLUMN IF EXISTS "aduRationale";

-- ---------- New columns ----------
ALTER TABLE "Listing"
  ADD COLUMN "assessorBasementSqft"   INTEGER,
  ADD COLUMN "detachedAduScore"       INTEGER,
  ADD COLUMN "detachedAduRationale"   TEXT,
  ADD COLUMN "convertedAduScore"      INTEGER,
  ADD COLUMN "convertedAduRationale"  TEXT,
  ADD COLUMN "convertedAduSource"     TEXT;

-- ---------- Recreate the materialized view ----------
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
  l."renovationLevel",
  l."renovationConfidence",
  l."aiStories",
  l."aiHasBasement",
  l."aiHasPenthouse",
  l."detachedAduScore",
  l."convertedAduScore",
  l."extractedTotalMonthlyRent",
  l."extractedOccupancy",
  l."pricePerSqft",
  l."pricePerUnit",
  l."sqftPerUnit",
  l."hasSizeDiscrepancy",
  s."densityScore",
  s."vacancyScore",
  s."motivationScore",
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
