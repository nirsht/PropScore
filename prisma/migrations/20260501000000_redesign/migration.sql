-- =========================================================================
-- Redesign migration: Assessor-first effective fields, hasSizeDiscrepancy
-- generated column, assessor lot/building values, AI listing-extract fields
-- (unit mix, rent roll, ADU potential, capex).
-- =========================================================================

-- ---------- Drop dependents in reverse order ----------
DROP MATERIALIZED VIEW IF EXISTS "mv_listing_search";

ALTER TABLE "Listing"
  DROP COLUMN IF EXISTS "pricePerSqft",
  DROP COLUMN IF EXISTS "pricePerUnit",
  DROP COLUMN IF EXISTS "sqftPerUnit",
  DROP COLUMN IF EXISTS "effectiveSqft",
  DROP COLUMN IF EXISTS "effectiveLotSizeSqft",
  DROP COLUMN IF EXISTS "effectiveStories";

-- ---------- New stored columns ----------
ALTER TABLE "Listing"
  -- Assessor financial values (Socrata wv5m-vpq2)
  ADD COLUMN "assessorBuildingValue"     INTEGER,
  ADD COLUMN "assessorLandValue"         INTEGER,
  -- AI listing-extract (gpt-4o-mini parses PublicRemarks/PrivateRemarks)
  ADD COLUMN "extractedUnitMix"          JSONB,
  ADD COLUMN "extractedRentRoll"         JSONB,
  ADD COLUMN "extractedTotalMonthlyRent" INTEGER,
  ADD COLUMN "extractedOccupancy"        DOUBLE PRECISION,
  ADD COLUMN "recentCapex"               JSONB,
  ADD COLUMN "aduPotential"              TEXT,
  ADD COLUMN "aduConfidence"             DOUBLE PRECISION,
  ADD COLUMN "aduRationale"              TEXT,
  ADD COLUMN "extractFetchedAt"          TIMESTAMP(3);

-- ---------- Resolved "effective" columns (ASSESSOR-FIRST) ----------
-- Assessor is the source of truth (official municipal record).
-- Falls back to MLS if assessor missing, then AI vision (stories only).
ALTER TABLE "Listing"
  ADD COLUMN "effectiveSqft" INTEGER GENERATED ALWAYS AS (
    COALESCE("assessorBuildingSqft", "sqft")
  ) STORED;

ALTER TABLE "Listing"
  ADD COLUMN "effectiveLotSizeSqft" INTEGER GENERATED ALWAYS AS (
    COALESCE("assessorLotSqft", "lotSizeSqft")
  ) STORED;

ALTER TABLE "Listing"
  ADD COLUMN "effectiveStories" INTEGER GENERATED ALWAYS AS (
    COALESCE("assessorStories", "stories", "aiStories")
  ) STORED;

-- ---------- Recreated derived ratios (assessor-first) ----------
ALTER TABLE "Listing"
  ADD COLUMN "pricePerSqft" DOUBLE PRECISION GENERATED ALWAYS AS (
    CASE WHEN COALESCE("assessorBuildingSqft", "sqft") IS NULL
              OR COALESCE("assessorBuildingSqft", "sqft") = 0
         THEN NULL
         ELSE "price"::double precision / COALESCE("assessorBuildingSqft", "sqft")
    END
  ) STORED;

ALTER TABLE "Listing"
  ADD COLUMN "pricePerUnit" DOUBLE PRECISION GENERATED ALWAYS AS (
    CASE WHEN COALESCE("assessorUnits", "units") IS NULL
              OR COALESCE("assessorUnits", "units") = 0
         THEN NULL
         ELSE "price"::double precision / COALESCE("assessorUnits", "units")
    END
  ) STORED;

ALTER TABLE "Listing"
  ADD COLUMN "sqftPerUnit" DOUBLE PRECISION GENERATED ALWAYS AS (
    CASE WHEN COALESCE("assessorUnits", "units") IS NULL
              OR COALESCE("assessorUnits", "units") = 0
              OR COALESCE("assessorBuildingSqft", "sqft") IS NULL
         THEN NULL
         ELSE COALESCE("assessorBuildingSqft", "sqft")::double precision
              / COALESCE("assessorUnits", "units")
    END
  ) STORED;

-- ---------- hasSizeDiscrepancy ----------
-- True when any MLS↔Assessor pair of sqft/lotSqft/units/stories differs >5%.
-- Used by the listings filter "show only listings with size disagreement".
ALTER TABLE "Listing"
  ADD COLUMN "hasSizeDiscrepancy" BOOLEAN GENERATED ALWAYS AS (
    (
      "sqft" IS NOT NULL AND "assessorBuildingSqft" IS NOT NULL
      AND GREATEST(ABS("sqft"), ABS("assessorBuildingSqft")) > 0
      AND ABS("sqft" - "assessorBuildingSqft")::double precision
          / GREATEST(ABS("sqft"), ABS("assessorBuildingSqft"))::double precision > 0.05
    )
    OR (
      "lotSizeSqft" IS NOT NULL AND "assessorLotSqft" IS NOT NULL
      AND GREATEST(ABS("lotSizeSqft"), ABS("assessorLotSqft")) > 0
      AND ABS("lotSizeSqft" - "assessorLotSqft")::double precision
          / GREATEST(ABS("lotSizeSqft"), ABS("assessorLotSqft"))::double precision > 0.05
    )
    OR (
      "units" IS NOT NULL AND "assessorUnits" IS NOT NULL
      AND GREATEST(ABS("units"), ABS("assessorUnits")) > 0
      AND ABS("units" - "assessorUnits")::double precision
          / GREATEST(ABS("units"), ABS("assessorUnits"))::double precision > 0.05
    )
    OR (
      "stories" IS NOT NULL AND "assessorStories" IS NOT NULL
      AND GREATEST(ABS("stories"), ABS("assessorStories")) > 0
      AND ABS("stories" - "assessorStories")::double precision
          / GREATEST(ABS("stories"), ABS("assessorStories"))::double precision > 0.05
    )
  ) STORED;

-- ---------- Indexes ----------
CREATE INDEX "Listing_pricePerSqft_idx"            ON "Listing" ("pricePerSqft");
CREATE INDEX "Listing_pricePerUnit_idx"            ON "Listing" ("pricePerUnit");
CREATE INDEX "Listing_sqftPerUnit_idx"             ON "Listing" ("sqftPerUnit");
CREATE INDEX "Listing_effectiveSqft_idx"           ON "Listing" ("effectiveSqft");
CREATE INDEX "Listing_effectiveStories_idx"        ON "Listing" ("effectiveStories");
CREATE INDEX "Listing_hasSizeDiscrepancy_idx"      ON "Listing" ("hasSizeDiscrepancy") WHERE "hasSizeDiscrepancy" = TRUE;
CREATE INDEX "Listing_assessorBuildingValue_idx"   ON "Listing" ("assessorBuildingValue");
CREATE INDEX "Listing_assessorLandValue_idx"       ON "Listing" ("assessorLandValue");

-- =========================================================================
-- Recreate the materialized view with new fields.
-- =========================================================================
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
