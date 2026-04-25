-- =========================================================================
-- PropScore initial migration
-- Enables postgis + pg_trgm, creates the Prisma schema, then layers on
-- generated columns, GIST/GIN indexes, and the materialized view used by
-- the hot read path. Run after Prisma's auto-generated SQL.
-- =========================================================================

CREATE EXTENSION IF NOT EXISTS "postgis";
CREATE EXTENSION IF NOT EXISTS "pg_trgm";

-- Roles
CREATE TYPE "Role" AS ENUM ('USER', 'ADMIN');
CREATE TYPE "ScoreSource" AS ENUM ('HEURISTIC', 'AI');
CREATE TYPE "SyncStatus" AS ENUM ('RUNNING', 'SUCCEEDED', 'FAILED');

-- ---------- User / Auth ----------
CREATE TABLE "User" (
  "id"             TEXT PRIMARY KEY,
  "email"          TEXT NOT NULL UNIQUE,
  "name"           TEXT,
  "hashedPassword" TEXT,
  "role"           "Role" NOT NULL DEFAULT 'USER',
  "createdAt"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"      TIMESTAMP(3) NOT NULL
);

CREATE TABLE "Account" (
  "id"                TEXT PRIMARY KEY,
  "userId"            TEXT NOT NULL REFERENCES "User"("id") ON DELETE CASCADE,
  "type"              TEXT NOT NULL,
  "provider"          TEXT NOT NULL,
  "providerAccountId" TEXT NOT NULL,
  "refresh_token"     TEXT,
  "access_token"      TEXT,
  "expires_at"        INTEGER,
  "token_type"        TEXT,
  "scope"             TEXT,
  "id_token"          TEXT,
  "session_state"     TEXT,
  UNIQUE ("provider", "providerAccountId")
);

CREATE TABLE "Session" (
  "id"           TEXT PRIMARY KEY,
  "sessionToken" TEXT NOT NULL UNIQUE,
  "userId"       TEXT NOT NULL REFERENCES "User"("id") ON DELETE CASCADE,
  "expires"      TIMESTAMP(3) NOT NULL
);

CREATE TABLE "VerificationToken" (
  "identifier" TEXT NOT NULL,
  "token"      TEXT NOT NULL UNIQUE,
  "expires"    TIMESTAMP(3) NOT NULL,
  UNIQUE ("identifier", "token")
);

-- ---------- Listing ----------
CREATE TABLE "Listing" (
  "mlsId"                       TEXT PRIMARY KEY,
  "address"                     TEXT NOT NULL,
  "city"                        TEXT,
  "state"                       TEXT,
  "postalCode"                  TEXT,
  "lat"                         DOUBLE PRECISION,
  "lng"                         DOUBLE PRECISION,
  "price"                       INTEGER NOT NULL,
  "daysOnMls"                   INTEGER NOT NULL,
  "postDate"                    TIMESTAMP(3) NOT NULL,
  "listingUpdatedAt"            TIMESTAMP(3) NOT NULL,
  "status"                      TEXT NOT NULL,
  "propertyType"                TEXT NOT NULL,
  "sqft"                        INTEGER,
  "units"                       INTEGER,
  "beds"                        INTEGER,
  "baths"                       DOUBLE PRECISION,
  "occupancy"                   DOUBLE PRECISION,
  "yearBuilt"                   INTEGER,
  "stories"                     INTEGER,
  "raw"                         JSONB NOT NULL,
  "bridgeModificationTimestamp" TIMESTAMP(3) NOT NULL,
  "createdAt"                   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  -- generated columns (indexable derived metrics)
  "pricePerSqft" DOUBLE PRECISION GENERATED ALWAYS AS (
    CASE WHEN "sqft" IS NULL OR "sqft" = 0 THEN NULL
         ELSE "price"::double precision / "sqft" END
  ) STORED,
  "pricePerUnit" DOUBLE PRECISION GENERATED ALWAYS AS (
    CASE WHEN "units" IS NULL OR "units" = 0 THEN NULL
         ELSE "price"::double precision / "units" END
  ) STORED,
  "sqftPerUnit" DOUBLE PRECISION GENERATED ALWAYS AS (
    CASE WHEN "units" IS NULL OR "units" = 0 OR "sqft" IS NULL THEN NULL
         ELSE "sqft"::double precision / "units" END
  ) STORED
);

-- PostGIS geography column + spatial index
ALTER TABLE "Listing"
  ADD COLUMN "geom" geography(Point, 4326)
  GENERATED ALWAYS AS (
    CASE WHEN "lng" IS NOT NULL AND "lat" IS NOT NULL
         THEN ST_SetSRID(ST_MakePoint("lng", "lat"), 4326)::geography
         ELSE NULL END
  ) STORED;

CREATE INDEX "Listing_price_idx"        ON "Listing" ("price");
CREATE INDEX "Listing_daysOnMls_idx"    ON "Listing" ("daysOnMls");
CREATE INDEX "Listing_propertyType_idx" ON "Listing" ("propertyType");
CREATE INDEX "Listing_yearBuilt_idx"    ON "Listing" ("yearBuilt");
CREATE INDEX "Listing_status_idx"       ON "Listing" ("status");
CREATE INDEX "Listing_bridgeMod_idx"    ON "Listing" ("bridgeModificationTimestamp");
CREATE INDEX "Listing_pricePerSqft_idx" ON "Listing" ("pricePerSqft");
CREATE INDEX "Listing_pricePerUnit_idx" ON "Listing" ("pricePerUnit");
CREATE INDEX "Listing_sqftPerUnit_idx"  ON "Listing" ("sqftPerUnit");
CREATE INDEX "Listing_units_idx"        ON "Listing" ("units");
CREATE INDEX "Listing_beds_idx"         ON "Listing" ("beds");
CREATE INDEX "Listing_baths_idx"        ON "Listing" ("baths");
CREATE INDEX "Listing_geom_gist"        ON "Listing" USING GIST ("geom");
CREATE INDEX "Listing_address_trgm"     ON "Listing" USING GIN ("address" gin_trgm_ops);
CREATE INDEX "Listing_city_trgm"        ON "Listing" USING GIN ("city" gin_trgm_ops);

-- ---------- Score ----------
CREATE TABLE "Score" (
  "listingMlsId"        TEXT PRIMARY KEY REFERENCES "Listing"("mlsId") ON DELETE CASCADE,
  "densityScore"        DOUBLE PRECISION NOT NULL,
  "vacancyScore"        DOUBLE PRECISION NOT NULL,
  "motivationScore"     DOUBLE PRECISION NOT NULL,
  "valueAddWeightedAvg" DOUBLE PRECISION NOT NULL,
  "breakdown"           JSONB NOT NULL,
  "computedBy"          "ScoreSource" NOT NULL,
  "computedAt"          TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX "Score_valueAdd_desc_idx"   ON "Score" ("valueAddWeightedAvg" DESC);
CREATE INDEX "Score_density_desc_idx"    ON "Score" ("densityScore" DESC);
CREATE INDEX "Score_vacancy_desc_idx"    ON "Score" ("vacancyScore" DESC);
CREATE INDEX "Score_motivation_desc_idx" ON "Score" ("motivationScore" DESC);

-- ---------- AIEnrichment ----------
CREATE TABLE "AIEnrichment" (
  "id"           TEXT PRIMARY KEY,
  "listingMlsId" TEXT NOT NULL REFERENCES "Listing"("mlsId") ON DELETE CASCADE,
  "agentName"    TEXT NOT NULL,
  "output"       JSONB NOT NULL,
  "createdAt"    TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX "AIEnrichment_listing_agent_idx" ON "AIEnrichment" ("listingMlsId", "agentName");

-- ---------- SyncRun ----------
CREATE TABLE "SyncRun" (
  "id"              TEXT PRIMARY KEY,
  "startedAt"       TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "finishedAt"      TIMESTAMP(3),
  "status"          "SyncStatus" NOT NULL DEFAULT 'RUNNING',
  "recordsUpserted" INTEGER NOT NULL DEFAULT 0,
  "recordsScored"   INTEGER NOT NULL DEFAULT 0,
  "cursorFrom"      TIMESTAMP(3),
  "cursorTo"        TIMESTAMP(3),
  "error"           TEXT
);
CREATE INDEX "SyncRun_startedAt_desc_idx" ON "SyncRun" ("startedAt" DESC);

-- ---------- AgentTrace ----------
CREATE TABLE "AgentTrace" (
  "id"        TEXT PRIMARY KEY,
  "agentName" TEXT NOT NULL,
  "userId"    TEXT REFERENCES "User"("id") ON DELETE SET NULL,
  "input"     JSONB NOT NULL,
  "output"    JSONB,
  "steps"     JSONB,
  "tokens"    INTEGER,
  "latencyMs" INTEGER,
  "error"     TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX "AgentTrace_agent_idx" ON "AgentTrace" ("agentName", "createdAt" DESC);
CREATE INDEX "AgentTrace_user_idx"  ON "AgentTrace" ("userId", "createdAt" DESC);

-- ---------- SavedFilter ----------
CREATE TABLE "SavedFilter" (
  "id"        TEXT PRIMARY KEY,
  "userId"    TEXT NOT NULL REFERENCES "User"("id") ON DELETE CASCADE,
  "name"      TEXT NOT NULL,
  "payload"   JSONB NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX "SavedFilter_user_idx" ON "SavedFilter" ("userId", "createdAt" DESC);

-- =========================================================================
-- Materialized view: the hot read path for the listings grid.
-- Refreshed CONCURRENTLY at the end of each ETL run.
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

CREATE UNIQUE INDEX "mv_listing_search_pk"        ON "mv_listing_search" ("mlsId");
CREATE INDEX "mv_listing_search_value_add_idx"     ON "mv_listing_search" ("valueAddWeightedAvg" DESC NULLS LAST);
CREATE INDEX "mv_listing_search_price_idx"         ON "mv_listing_search" ("price");
CREATE INDEX "mv_listing_search_pricePerSqft_idx"  ON "mv_listing_search" ("pricePerSqft");
CREATE INDEX "mv_listing_search_pricePerUnit_idx"  ON "mv_listing_search" ("pricePerUnit");
CREATE INDEX "mv_listing_search_propertyType_idx"  ON "mv_listing_search" ("propertyType");
CREATE INDEX "mv_listing_search_yearBuilt_idx"     ON "mv_listing_search" ("yearBuilt");
CREATE INDEX "mv_listing_search_geom_gist"         ON "mv_listing_search" USING GIST ("geom");
CREATE INDEX "mv_listing_search_address_trgm"      ON "mv_listing_search" USING GIN ("address" gin_trgm_ops);
