-- ListingContact: agent + brokerage contact details, hydrated from the
-- RentCast API by `scripts/enrich-contacts.ts`. Bridge `sfar` is an IDX
-- feed and strips ListAgentDirectPhone / ListAgentEmail / ListOfficePhone,
-- so the drawer's "Listed by" + Brokerage rows have nothing to render
-- without this enrichment layer. `source` lets us swap to a Bridge VOW
-- feed later without renaming columns; `fetchedAt` drives the 30-day
-- refresh window in contact-enrichment.ts.

CREATE TABLE "ListingContact" (
    "id"             TEXT NOT NULL,
    "listingMlsId"   TEXT NOT NULL,
    "source"         TEXT NOT NULL,
    "agentName"      TEXT,
    "agentPhone"     TEXT,
    "agentEmail"     TEXT,
    "agentWebsite"   TEXT,
    "officeName"     TEXT,
    "officePhone"    TEXT,
    "officeEmail"    TEXT,
    "officeWebsite"  TEXT,
    "fetchedAt"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "raw"            JSONB,

    CONSTRAINT "ListingContact_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "ListingContact_listingMlsId_key" ON "ListingContact"("listingMlsId");
CREATE INDEX "ListingContact_fetchedAt_idx" ON "ListingContact"("fetchedAt");
CREATE INDEX "ListingContact_source_idx" ON "ListingContact"("source");

ALTER TABLE "ListingContact"
  ADD CONSTRAINT "ListingContact_listingMlsId_fkey"
  FOREIGN KEY ("listingMlsId") REFERENCES "Listing"("mlsId")
  ON DELETE CASCADE ON UPDATE CASCADE;
