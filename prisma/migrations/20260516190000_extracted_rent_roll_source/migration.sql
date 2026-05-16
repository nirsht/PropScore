-- =========================================================================
-- Add Listing.extractedRentRollSource provenance column.
--
-- The Gmail rent-roll outreach feature (commit 172da96) introduced
-- `Listing.extractedRentRollSource` in schema.prisma but did not generate
-- a migration. Production already has rows where listing-extract has
-- populated `extractedRentRoll` — those rows get NULL here and are treated
-- as "unknown provenance" by RentRollSection (no badge shown).
--
-- Values written by the app:
--   "ai_extraction" — listing-extract agent parsed it from MLS remarks
--   "email_reply"   — email-rent-roll agent parsed it from an agent reply
--   NULL            — no rent roll extracted yet, or pre-feature backfill
-- =========================================================================

ALTER TABLE "Listing"
  ADD COLUMN IF NOT EXISTS "extractedRentRollSource" TEXT;
