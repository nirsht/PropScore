-- =========================================================================
-- DOM is now derived at MV-refresh time from postDate, not stored.
--
-- Why:
--   Bridge's `DaysOnMarket` field is a snapshot the source MLS wrote at the
--   last modification event. It does not tick forward — a listing whose
--   MLS row hasn't been touched in months still reports the DOM Bridge
--   captured back then. The SFAR feed also frequently reports `0` for
--   reactivated / freshly-modified listings, which we were storing
--   verbatim and showing as "0 DOM" for listings that have been live for
--   weeks. Both failure modes were visible to users in the grid.
--
-- Strategy:
--   1. `Listing.daysOnMls` becomes nullable. It is now a forensic snapshot
--      of whatever Bridge said — `NULL` when Bridge says 0/missing.
--   2. `mv_listing_search.daysOnMls` is derived from
--      `(CURRENT_DATE - postDate::date)` at MV-refresh time, so the grid
--      shows a value that moves day-by-day even when Bridge is silent.
--      Returns NULL only when postDate is missing or in the future
--      (which `normalize.ts` already rejects, so in practice never).
--   3. The same Listing-column-only index on daysOnMls is dropped — no
--      live query reads it (sort/filter goes through the MV).
-- =========================================================================

ALTER TABLE "Listing"
  ALTER COLUMN "daysOnMls" DROP NOT NULL;

DROP INDEX IF EXISTS "Listing_daysOnMls_idx";

-- Null out any zeroes already in the DB so legacy data lines up with the
-- new normalize.ts policy (Bridge `0` → NULL). The MV-derived `daysOnMls`
-- ignores this column entirely, but keeping the snapshot honest matters
-- for anything reading `Listing.daysOnMls` directly.
UPDATE "Listing" SET "daysOnMls" = NULL WHERE "daysOnMls" = 0;

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
  -- DOM derived live (as of MV refresh) from postDate. Capped at 0 so a
  -- clock-skew "postDate in the future" can't produce negative DOMs.
  CASE
    WHEN l."postDate" IS NULL THEN NULL
    ELSE GREATEST(0, (CURRENT_DATE - l."postDate"::date))::int
  END                                                  AS "daysOnMls",
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
  s."rehabScore",
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
CREATE INDEX "mv_listing_search_rehabScore_idx"                  ON "mv_listing_search" ("rehabScore" DESC NULLS LAST);
CREATE INDEX "mv_listing_search_marketUpsideScore_idx"           ON "mv_listing_search" ("marketUpsideScore" DESC NULLS LAST);
CREATE INDEX "mv_listing_search_zoningDistrict_idx"              ON "mv_listing_search" ("zoningDistrict");
CREATE INDEX "mv_listing_search_codeViolationsOpenCount_idx"     ON "mv_listing_search" ("codeViolationsOpenCount");
CREATE INDEX "mv_listing_search_housingNetUnitChange5y_idx"      ON "mv_listing_search" ("housingNetUnitChange5y");
CREATE INDEX "mv_listing_search_rentControlCovered_idx"          ON "mv_listing_search" ("rentControlCovered") WHERE "rentControlCovered" IS NOT NULL;
CREATE INDEX "mv_listing_search_softStoryRedFlag_idx"            ON "mv_listing_search" ("softStoryRedFlag") WHERE "softStoryRedFlag" IS NOT NULL;
CREATE INDEX "mv_listing_search_deletedAt_null_idx"              ON "mv_listing_search" ("mlsId") WHERE "deletedAt" IS NULL;
