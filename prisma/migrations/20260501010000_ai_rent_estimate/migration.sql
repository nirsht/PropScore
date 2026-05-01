-- AI-estimated market-rate rents per unit type, emitted by the
-- listing-extract agent alongside extractedUnitMix. The UI joins it to
-- unitMix on (beds, baths) and falls back to it when the listing doesn't
-- disclose actual rents in extractedRentRoll.
ALTER TABLE "Listing" ADD COLUMN "aiRentEstimate" JSONB;
