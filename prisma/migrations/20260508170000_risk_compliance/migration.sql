-- Risk & Compliance signals: regulatory-health overlays for the
-- RiskComplianceCard + filters. Filter+display only — these do NOT enter the
-- value-add weighted average.
--
-- Three signals:
--   * Code Enforcement (DBI Notice of Violations on data.sfgov.org) — open
--     count + 5y history per parcel, latest NOV breadcrumb.
--   * Housing Inventory (Socrata 6v9b-p59r) — net unit gain/loss attributed
--     to the parcel over the last 5 reporting years.
--   * Rent control coverage — derived from yearBuilt + units + landUseCategory
--     (multi-unit residential built before 1979-06-13).

-- ---------- Listing additions ----------
ALTER TABLE "Listing"
  ADD COLUMN "codeViolationsOpenCount"    INTEGER,
  ADD COLUMN "codeViolationsRecentCount"  INTEGER,
  ADD COLUMN "codeViolationsLatest"       JSONB,
  ADD COLUMN "codeViolationsFetchedAt"    TIMESTAMP(3),
  ADD COLUMN "housingNetUnitChange5y"     INTEGER,
  ADD COLUMN "housingInventoryFetchedAt"  TIMESTAMP(3),
  ADD COLUMN "rentControlCovered"         BOOLEAN,
  ADD COLUMN "rentControlComputedAt"      TIMESTAMP(3);

CREATE INDEX "Listing_codeViolationsOpenCount_idx" ON "Listing" ("codeViolationsOpenCount");
CREATE INDEX "Listing_housingNetUnitChange5y_idx"  ON "Listing" ("housingNetUnitChange5y");
CREATE INDEX "Listing_rentControlCovered_idx"      ON "Listing" ("rentControlCovered");

-- =========================================================================
-- Recreate the materialized view so the new fields are filterable through
-- the listings search SQL builder (`src/server/api/listings-search.ts`).
-- Extends 20260508020000_market_upside's MV with the three risk/compliance
-- columns; preserves every existing column + index from that migration.
-- =========================================================================
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
  s."computedBy"   AS "scoreComputedBy",
  s."computedAt"   AS "scoreComputedAt"
FROM "Listing" l
LEFT JOIN "Score" s ON s."listingMlsId" = l."mlsId"
WHERE l."status" = 'Active';

CREATE UNIQUE INDEX "mv_listing_search_pk"                       ON "mv_listing_search" ("mlsId");
CREATE INDEX "mv_listing_search_value_add_idx"                   ON "mv_listing_search" ("valueAddWeightedAvg" DESC NULLS LAST);
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
