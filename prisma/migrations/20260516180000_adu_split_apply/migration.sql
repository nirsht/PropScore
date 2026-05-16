-- =========================================================================
-- ADU feasibility split (corrective re-issue). The original
-- 20260508180000_adu_split migration was authored on a feature branch and
-- merged into main AFTER several later migrations (score_ai_columns,
-- starred_listings, soft_story) had already been deployed to prod. Applying
-- it now would recreate `mv_listing_search` in its 2026-05-08 shape and
-- silently drop `softStoryRedFlag` and the five ai* score columns that
-- listings-search.ts now depends on.
--
-- This migration replaces the original adu_split. It performs the same
-- Listing column changes (drop legacy aduPotential/aduConfidence/aduRationale,
-- add assessorBasementSqft + detached/converted ADU columns) and recreates
-- `mv_listing_search` with the FULL union shape: score_ai_columns' projection
-- + softStoryRedFlag + detached/converted ADU swapped in for aduPotential/
-- aduConfidence, with the LOW/MEDIUM/HIGH fallback on aduScore removed.
-- =========================================================================

-- The MV currently references aduPotential/aduConfidence (soft_story shape),
-- so we must drop it before dropping those columns.
DROP MATERIALIZED VIEW IF EXISTS "mv_listing_search";

-- ---------- Drop legacy LOW/MEDIUM/HIGH columns ----------
ALTER TABLE "Listing"
  DROP COLUMN IF EXISTS "aduPotential",
  DROP COLUMN IF EXISTS "aduConfidence",
  DROP COLUMN IF EXISTS "aduRationale";

-- ---------- New columns ----------
-- IF NOT EXISTS so the migration is idempotent if the original
-- 20260508180000_adu_split migration was applied in parallel — the
-- columns it adds are identical to ours.
ALTER TABLE "Listing"
  ADD COLUMN IF NOT EXISTS "assessorBasementSqft"   INTEGER,
  ADD COLUMN IF NOT EXISTS "detachedAduScore"       INTEGER,
  ADD COLUMN IF NOT EXISTS "detachedAduRationale"   TEXT,
  ADD COLUMN IF NOT EXISTS "convertedAduScore"      INTEGER,
  ADD COLUMN IF NOT EXISTS "convertedAduRationale"  TEXT,
  ADD COLUMN IF NOT EXISTS "convertedAduSource"     TEXT;

-- ---------- Recreate the materialized view ----------
-- Final shape = score_ai_columns projection + softStoryRedFlag, with
-- aduPotential/aduConfidence replaced by detachedAduScore/convertedAduScore
-- and the CASE-based fallback on aduScore removed (Score.aduScore is the
-- only path now).
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
  l."detachedAduScore",
  l."convertedAduScore",
  l."extractedTotalMonthlyRent",
  l."extractedOccupancy",
  l."pricePerSqft",
  l."pricePerUnit",
  l."sqftPerUnit",
  l."hasSizeDiscrepancy",
  l."locationScore"       AS "listingLocationScore",
  l."zoningDistrict",
  l."zoningMaxUnits",
  l."codeViolationsOpenCount",
  l."codeViolationsRecentCount",
  l."housingNetUnitChange5y",
  l."rentControlCovered",
  l."softStoryRedFlag",
  s."densityScore",
  s."vacancyScore",
  s."motivationScore",
  COALESCE(s."locationScore", l."locationScore") AS "locationScore",
  s."aduScore",
  s."assessmentDeltaScore",
  s."zoningUpsideScore",
  s."marketUpsideScore",
  s."valueAddWeightedAvg",
  s."aiDensityScore",
  s."aiVacancyScore",
  s."aiMotivationScore",
  s."aiValueAddWeightedAvg",
  s."aiComputedAt",
  s."computedBy"   AS "scoreComputedBy",
  s."computedAt"   AS "scoreComputedAt"
FROM "Listing" l
LEFT JOIN "Score" s ON s."listingMlsId" = l."mlsId"
WHERE l."status" = 'Active';

CREATE UNIQUE INDEX "mv_listing_search_pk"                       ON "mv_listing_search" ("mlsId");
CREATE INDEX "mv_listing_search_value_add_idx"                   ON "mv_listing_search" ("valueAddWeightedAvg" DESC NULLS LAST);
CREATE INDEX "mv_listing_search_ai_value_add_idx"                ON "mv_listing_search" ("aiValueAddWeightedAvg" DESC NULLS LAST);
CREATE INDEX "mv_listing_search_ai_density_idx"                  ON "mv_listing_search" ("aiDensityScore" DESC NULLS LAST);
CREATE INDEX "mv_listing_search_ai_vacancy_idx"                  ON "mv_listing_search" ("aiVacancyScore" DESC NULLS LAST);
CREATE INDEX "mv_listing_search_ai_motivation_idx"               ON "mv_listing_search" ("aiMotivationScore" DESC NULLS LAST);
CREATE INDEX "mv_listing_search_price_idx"                       ON "mv_listing_search" ("price");
CREATE INDEX "mv_listing_search_pricePerSqft_idx"                ON "mv_listing_search" ("pricePerSqft");
CREATE INDEX "mv_listing_search_pricePerUnit_idx"                ON "mv_listing_search" ("pricePerUnit");
CREATE INDEX "mv_listing_search_propertyType_idx"                ON "mv_listing_search" ("propertyType");
CREATE INDEX "mv_listing_search_yearBuilt_idx"                   ON "mv_listing_search" ("yearBuilt");
CREATE INDEX "mv_listing_search_renovationLevel_idx"             ON "mv_listing_search" ("renovationLevel");
CREATE INDEX "mv_listing_search_geom_gist"                       ON "mv_listing_search" USING GIST ("geom");
CREATE INDEX "mv_listing_search_address_trgm"                    ON "mv_listing_search" USING GIN ("address" gin_trgm_ops);
CREATE INDEX "mv_listing_search_hasSizeDiscrepancy_idx"          ON "mv_listing_search" ("hasSizeDiscrepancy") WHERE "hasSizeDiscrepancy" = TRUE;
CREATE INDEX "mv_listing_search_locationScore_idx"               ON "mv_listing_search" ("locationScore" DESC NULLS LAST);
CREATE INDEX "mv_listing_search_aduScore_idx"                    ON "mv_listing_search" ("aduScore" DESC NULLS LAST);
CREATE INDEX "mv_listing_search_marketUpsideScore_idx"           ON "mv_listing_search" ("marketUpsideScore" DESC NULLS LAST);
CREATE INDEX "mv_listing_search_zoningDistrict_idx"              ON "mv_listing_search" ("zoningDistrict");
CREATE INDEX "mv_listing_search_codeViolationsOpenCount_idx"     ON "mv_listing_search" ("codeViolationsOpenCount");
CREATE INDEX "mv_listing_search_housingNetUnitChange5y_idx"      ON "mv_listing_search" ("housingNetUnitChange5y");
CREATE INDEX "mv_listing_search_rentControlCovered_idx"          ON "mv_listing_search" ("rentControlCovered") WHERE "rentControlCovered" IS NOT NULL;
CREATE INDEX "mv_listing_search_softStoryRedFlag_idx"            ON "mv_listing_search" ("softStoryRedFlag") WHERE "softStoryRedFlag" IS NOT NULL;
