-- =========================================================================
-- ADD: disclosed aggregate MARKET / pro-forma gross rent (monthly) on Listing.
--
-- Value-add multifamily remarks frequently state a building-level income
-- story as annual aggregates ("in-place rents of ~$265,000/yr sit well below
-- today's market of ~$490,000") instead of a per-unit rent roll. The existing
-- extractedTotalMonthlyRent captures the in-place side; this column captures
-- the disclosed MARKET side so the drawer can show the real upside, sourced
-- from the listing agent's own numbers rather than coarse per-unit AI guesses.
--
-- Drawer-only field — not projected into mv_listing_search (the search grid),
-- so no materialized-view rebuild is needed here.
-- =========================================================================

ALTER TABLE "Listing"
  ADD COLUMN IF NOT EXISTS "extractedMarketMonthlyRent" INTEGER;
