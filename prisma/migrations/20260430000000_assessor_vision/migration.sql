-- =========================================================================
-- Enrich Listing with SF Assessor (Socrata i8ew-h6z7) + AI building vision.
--
-- Drops & recreates the materialized view + the pricePerSqft/pricePerUnit/
-- sqftPerUnit generated columns so the hot read path uses the resolved
-- "effective" sqft/units/stories instead of the MLS-only originals.
-- =========================================================================

-- ---------- Enum ----------
CREATE TYPE "RenovationLevel" AS ENUM ('DISTRESSED', 'ORIGINAL', 'UPDATED', 'RENOVATED');

-- ---------- Drop dependents in reverse order ----------
DROP MATERIALIZED VIEW IF EXISTS "mv_listing_search";

-- The three generated columns must be dropped before we can change the
-- inputs to their formulas.
ALTER TABLE "Listing"
  DROP COLUMN IF EXISTS "pricePerSqft",
  DROP COLUMN IF EXISTS "pricePerUnit",
  DROP COLUMN IF EXISTS "sqftPerUnit";

-- ---------- New stored columns ----------
ALTER TABLE "Listing"
  ADD COLUMN "blockLot"                 TEXT,
  ADD COLUMN "block"                    TEXT,
  ADD COLUMN "lot"                      TEXT,
  ADD COLUMN "assessorBuildingSqft"     INTEGER,
  ADD COLUMN "assessorLotSqft"          INTEGER,
  ADD COLUMN "assessorYearBuilt"        INTEGER,
  ADD COLUMN "assessorStories"          INTEGER,
  ADD COLUMN "assessorUnits"            INTEGER,
  ADD COLUMN "assessorRooms"            INTEGER,
  ADD COLUMN "assessorBedrooms"         INTEGER,
  ADD COLUMN "assessorBathrooms"        DOUBLE PRECISION,
  ADD COLUMN "assessorUseType"          TEXT,
  ADD COLUMN "assessorConstructionType" TEXT,
  ADD COLUMN "assessorBasement"         TEXT,
  ADD COLUMN "assessorFetchedAt"        TIMESTAMP(3),
  ADD COLUMN "aiStories"                INTEGER,
  ADD COLUMN "aiHasBasement"            BOOLEAN,
  ADD COLUMN "aiHasPenthouse"           BOOLEAN,
  ADD COLUMN "aiBestPhotoUrl"           TEXT,
  ADD COLUMN "renovationLevel"          "RenovationLevel",
  ADD COLUMN "renovationConfidence"     DOUBLE PRECISION,
  ADD COLUMN "visionFetchedAt"          TIMESTAMP(3);

-- ---------- Resolved "effective" columns ----------
-- Generated so they stay in lock-step with the inputs and can be indexed
-- the same way the original price-per-* columns were.
ALTER TABLE "Listing"
  ADD COLUMN "effectiveSqft" INTEGER GENERATED ALWAYS AS (
    COALESCE("sqft", "assessorBuildingSqft")
  ) STORED;

ALTER TABLE "Listing"
  ADD COLUMN "effectiveLotSizeSqft" INTEGER GENERATED ALWAYS AS (
    COALESCE("lotSizeSqft", "assessorLotSqft")
  ) STORED;

ALTER TABLE "Listing"
  ADD COLUMN "effectiveStories" INTEGER GENERATED ALWAYS AS (
    COALESCE("stories", "aiStories", "assessorStories")
  ) STORED;

-- ---------- Recreated derived ratios (now driven by effective + assessor units) ----------
ALTER TABLE "Listing"
  ADD COLUMN "pricePerSqft" DOUBLE PRECISION GENERATED ALWAYS AS (
    CASE WHEN COALESCE("sqft", "assessorBuildingSqft") IS NULL
              OR COALESCE("sqft", "assessorBuildingSqft") = 0
         THEN NULL
         ELSE "price"::double precision / COALESCE("sqft", "assessorBuildingSqft")
    END
  ) STORED;

ALTER TABLE "Listing"
  ADD COLUMN "pricePerUnit" DOUBLE PRECISION GENERATED ALWAYS AS (
    CASE WHEN COALESCE("units", "assessorUnits") IS NULL
              OR COALESCE("units", "assessorUnits") = 0
         THEN NULL
         ELSE "price"::double precision / COALESCE("units", "assessorUnits")
    END
  ) STORED;

ALTER TABLE "Listing"
  ADD COLUMN "sqftPerUnit" DOUBLE PRECISION GENERATED ALWAYS AS (
    CASE WHEN COALESCE("units", "assessorUnits") IS NULL
              OR COALESCE("units", "assessorUnits") = 0
              OR COALESCE("sqft", "assessorBuildingSqft") IS NULL
         THEN NULL
         ELSE COALESCE("sqft", "assessorBuildingSqft")::double precision
              / COALESCE("units", "assessorUnits")
    END
  ) STORED;

-- ---------- Indexes ----------
CREATE INDEX "Listing_blockLot_idx"           ON "Listing" ("blockLot");
CREATE INDEX "Listing_renovationLevel_idx"    ON "Listing" ("renovationLevel");
CREATE INDEX "Listing_pricePerSqft_idx"       ON "Listing" ("pricePerSqft");
CREATE INDEX "Listing_pricePerUnit_idx"       ON "Listing" ("pricePerUnit");
CREATE INDEX "Listing_sqftPerUnit_idx"        ON "Listing" ("sqftPerUnit");
CREATE INDEX "Listing_effectiveSqft_idx"      ON "Listing" ("effectiveSqft");
CREATE INDEX "Listing_effectiveStories_idx"   ON "Listing" ("effectiveStories");

-- =========================================================================
-- Recreate the materialized view with the new effective columns + renovation.
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
  COALESCE(l."units", l."assessorUnits")            AS "effectiveUnits",
  l."assessorBuildingSqft",
  l."assessorLotSqft",
  l."assessorUnits",
  l."assessorYearBuilt",
  l."assessorStories",
  l."renovationLevel",
  l."renovationConfidence",
  l."aiStories",
  l."aiHasBasement",
  l."aiHasPenthouse",
  l."pricePerSqft",
  l."pricePerUnit",
  l."sqftPerUnit",
  s."densityScore",
  s."vacancyScore",
  s."motivationScore",
  s."valueAddWeightedAvg",
  s."computedBy"   AS "scoreComputedBy",
  s."computedAt"   AS "scoreComputedAt"
FROM "Listing" l
LEFT JOIN "Score" s ON s."listingMlsId" = l."mlsId"
WHERE l."status" = 'Active';

CREATE UNIQUE INDEX "mv_listing_search_pk"               ON "mv_listing_search" ("mlsId");
CREATE INDEX "mv_listing_search_value_add_idx"           ON "mv_listing_search" ("valueAddWeightedAvg" DESC NULLS LAST);
CREATE INDEX "mv_listing_search_price_idx"               ON "mv_listing_search" ("price");
CREATE INDEX "mv_listing_search_pricePerSqft_idx"        ON "mv_listing_search" ("pricePerSqft");
CREATE INDEX "mv_listing_search_pricePerUnit_idx"        ON "mv_listing_search" ("pricePerUnit");
CREATE INDEX "mv_listing_search_propertyType_idx"        ON "mv_listing_search" ("propertyType");
CREATE INDEX "mv_listing_search_yearBuilt_idx"           ON "mv_listing_search" ("yearBuilt");
CREATE INDEX "mv_listing_search_renovationLevel_idx"     ON "mv_listing_search" ("renovationLevel");
CREATE INDEX "mv_listing_search_geom_gist"               ON "mv_listing_search" USING GIST ("geom");
CREATE INDEX "mv_listing_search_address_trgm"            ON "mv_listing_search" USING GIN ("address" gin_trgm_ops);
