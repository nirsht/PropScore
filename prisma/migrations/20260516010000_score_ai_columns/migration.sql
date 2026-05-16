-- Add parallel AI-scored columns to Score so the heuristic and AI scores
-- coexist on the same row. Previously AI scoring overwrote the heuristic
-- columns (densityScore, vacancyScore, motivationScore, valueAddWeightedAvg)
-- and set computedBy=AI; recompute:scores then skipped those rows entirely.
-- Going forward heuristic always lives in the original columns and AI in
-- the ai* columns below, so the UI can sort by either source independently.

ALTER TABLE "Score"
  ADD COLUMN "aiDensityScore"        DOUBLE PRECISION,
  ADD COLUMN "aiVacancyScore"        DOUBLE PRECISION,
  ADD COLUMN "aiMotivationScore"     DOUBLE PRECISION,
  ADD COLUMN "aiValueAddWeightedAvg" DOUBLE PRECISION,
  ADD COLUMN "aiBreakdown"           JSONB,
  ADD COLUMN "aiComputedAt"          TIMESTAMP(3);

CREATE INDEX "Score_aiValueAddWeightedAvg_idx" ON "Score" ("aiValueAddWeightedAvg" DESC);
CREATE INDEX "Score_aiDensityScore_idx"        ON "Score" ("aiDensityScore" DESC);
CREATE INDEX "Score_aiVacancyScore_idx"        ON "Score" ("aiVacancyScore" DESC);
CREATE INDEX "Score_aiMotivationScore_idx"     ON "Score" ("aiMotivationScore" DESC);

-- Backfill the heuristic columns from prior AI writes so no listing
-- loses its currently-displayed score during the transition. Rows whose
-- last write was AI: copy the AI scores into both sides (heuristic gets
-- overwritten on the next recompute; AI side remains the AI value).
UPDATE "Score"
  SET "aiDensityScore"        = "densityScore",
      "aiVacancyScore"        = "vacancyScore",
      "aiMotivationScore"     = "motivationScore",
      "aiValueAddWeightedAvg" = "valueAddWeightedAvg",
      "aiBreakdown"           = "breakdown",
      "aiComputedAt"          = "computedAt"
  WHERE "computedBy" = 'AI';

-- Refresh the listings materialized view so the listings table can SELECT
-- both column sets. Mirrors the column list from 20260508170000_risk_compliance.
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
  l."codeViolationsOpenCount",
  l."codeViolationsRecentCount",
  l."housingNetUnitChange5y",
  l."rentControlCovered",
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
