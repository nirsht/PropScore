-- Score schema v4: surface location + ADU as first-class component scores
-- so the listings view can ORDER BY a user-configurable weighted blend of
-- (vacancy, location, density, adu, motivation) rather than relying on a
-- single precomputed `valueAddWeightedAvg` baked at write-time.
--
-- Both columns are nullable: existing rows are backfilled via
-- `pnpm recompute-scores` rather than in this migration so that ADU/
-- location absences propagate correctly through the null-aware divisor
-- in `weightedValueAdd`.

ALTER TABLE "Score"
  ADD COLUMN "locationScore" DOUBLE PRECISION,
  ADD COLUMN "aduScore"      DOUBLE PRECISION;

CREATE INDEX "Score_locationScore_idx" ON "Score" ("locationScore" DESC);
CREATE INDEX "Score_aduScore_idx"      ON "Score" ("aduScore" DESC);

-- Refresh the listings materialized view to expose the new columns.
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
  s."densityScore",
  s."vacancyScore",
  s."motivationScore",
  -- Prefer Score.locationScore (snapshotted at score time) but fall back
  -- to Listing.locationScore when an older Score row predates the v4
  -- backfill. Same idea for aduScore via Listing.aduPotential mapping.
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
