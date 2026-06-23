-- =========================================================================
-- Listing offboarding: soft-delete listings that have fallen off Bridge.
--
-- `lastSeenAt` is bumped on every Bridge sync that surfaces this ListingKey
-- (incremental upsert *or* the `offboard-stale` ListingKey sweep). The
-- sweep marks `deletedAt = now()` for any listing whose lastSeenAt didn't
-- get bumped this run (i.e., gone for >=2 consecutive sweeps). A
-- resurrected listing clears deletedAt automatically on next upsert.
--
-- Forensic data (scores, enrichments, contacts, chats, emails, documents)
-- stays intact: only the visibility flag changes.
-- =========================================================================

ALTER TABLE "Listing"
  ADD COLUMN IF NOT EXISTS "lastSeenAt" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "deletedAt"  TIMESTAMP(3);

CREATE INDEX IF NOT EXISTS "Listing_deletedAt_idx" ON "Listing" ("deletedAt");

-- Recreate mv_listing_search so it exposes `deletedAt` as a column. The
-- safety-belt `WHERE status = 'Active'` stays; the UI's "Show offboarded"
-- toggle filters/keeps offboarded rows by checking the column, not by
-- excluding them at MV-build time (which would force a separate query
-- path for offboarded listings).
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
  l."deletedAt",
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
-- Partial index for the default "hide offboarded" path — covers the
-- predicate the search WHERE will use most often.
CREATE INDEX "mv_listing_search_deletedAt_null_idx"              ON "mv_listing_search" ("mlsId") WHERE "deletedAt" IS NULL;
