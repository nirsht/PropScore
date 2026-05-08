-- =========================================================================
-- ADU feasibility split: replace single LOW/MEDIUM/HIGH `aduPotential` with
-- two parallel 0–100 reads — `detachedAduScore` (vacant-yard ADU) and
-- `convertedAduScore` (repurpose basement/garage). Adds `convertedAduSource`
-- and a numeric `assessorBasementSqft` to drive the converted score.
--
-- Runs AFTER `20260508010000_score_components_v4`, which already added the
-- `Score.aduScore` / `Score.locationScore` columns and rebuilt the
-- materialized view referencing `Listing.aduPotential` / `aduConfidence`.
-- We drop that view first, drop the old columns, add the new ones, and
-- recreate the v4 view without the legacy ADU fallback path.
-- =========================================================================

-- Drop the v4 MV first; it references aduPotential / aduConfidence.
DROP MATERIALIZED VIEW IF EXISTS "mv_listing_search";

-- ---------- Drop legacy LOW/MEDIUM/HIGH columns ----------
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
-- Mirrors the v4 shape from 20260508010000_score_components_v4, with two
-- changes:
--   1. The legacy `aduPotential` / `aduConfidence` columns are gone — drop
--      them from the projection and drop the LOW/MEDIUM/HIGH fallback
--      mapping for `aduScore`. `Score.aduScore` is the only source now;
--      `recompute-scores` reseeds it from the new detached/converted reads.
--   2. Surface `detachedAduScore` / `convertedAduScore` directly so the
--      drawer chips can read them without a separate Listing fetch.
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
  l."locationScore"       AS "listingLocationScore",
  s."densityScore",
  s."vacancyScore",
  s."motivationScore",
  COALESCE(s."locationScore", l."locationScore") AS "locationScore",
  s."aduScore",
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
