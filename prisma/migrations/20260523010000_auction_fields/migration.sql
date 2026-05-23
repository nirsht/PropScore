-- Auction signals from RESO (Bridge `sfar`).
-- isAuction is set when any of SpecialListingConditions / ListingTerms /
-- AuctionDate flag the listing as an auction; auctionDate captures the
-- scheduled auction time when present.
ALTER TABLE "Listing" ADD COLUMN IF NOT EXISTS "isAuction" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "Listing" ADD COLUMN IF NOT EXISTS "auctionDate" TIMESTAMP(3);
