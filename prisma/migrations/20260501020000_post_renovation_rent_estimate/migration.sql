-- AI-estimated market-rate rents per unit type AFTER a moderate cosmetic
-- renovation. Same shape as aiRentEstimate ([{beds, baths, estimatedRent,
-- rationale}]). The drawer surfaces this as the third column ("Post-remodel")
-- in the Rent Roll section.
ALTER TABLE "Listing" ADD COLUMN "postRenovationRentEstimate" JSONB;
