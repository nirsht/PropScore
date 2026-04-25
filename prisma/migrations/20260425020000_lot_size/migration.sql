-- Lot size as a first-class field so the drawer falls back to lot
-- when the MLS hasn't populated building sqft (matches Zillow's behavior).
ALTER TABLE "Listing" ADD COLUMN "lotSizeSqft" INTEGER;
CREATE INDEX "Listing_lotSizeSqft_idx" ON "Listing" ("lotSizeSqft");
