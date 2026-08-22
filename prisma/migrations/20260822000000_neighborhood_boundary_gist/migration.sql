-- =========================================================================
-- Add the missing GiST index on Neighborhood.boundary.
--
-- `resolveNeighborhoods()` in src/server/etl/pipeline.ts claimed to run
-- "against the Neighborhood.boundary GIST index" — but no such index ever
-- existed. Without it the point-in-polygon backfill degenerates into a
-- nested loop over the full cross product:
--
--   Update on "Listing" l  (cost=0.00..64643829.26)
--     ->  Nested Loop
--           Join Filter: st_intersects(n.boundary, l.geom)
--           ->  Seq Scan on "Neighborhood"  (rows=53 width=16740)
--           ->  Materialize -> Seq Scan on "Listing"  (rows=97394)
--
-- i.e. ~5.2M ST_Intersects calls against large multipolygons. In production
-- that statement ran ~32 minutes, dropped the connection, and was then
-- retried 8x by the transient-retry wrapper in src/lib/db.ts — burning
-- ~3h15m of the daily cron's 12h budget every night and repeatedly pushing
-- the shared Postgres into recovery mode (which in turn broke the
-- concurrently-running LLM cron). It never once succeeded: 97,411 of
-- 100,062 geocoded listings still had a NULL neighborhood.
--
-- Neighborhood holds ~41-53 rows, so this index builds instantly and needs
-- no CONCURRENTLY (which Prisma cannot run inside its migration
-- transaction anyway).
--
-- Note: Listing.geom is deliberately NOT indexed here. The planner only
-- needs one side of the join indexed, and Listing is a 531 MB / 100k-row
-- table whose plain CREATE INDEX would hold a write lock. Add it separately
-- with CREATE INDEX CONCURRENTLY (outside a migration) if other spatial
-- queries later need it.
-- =========================================================================

CREATE INDEX IF NOT EXISTS "Neighborhood_boundary_gist"
  ON "Neighborhood" USING GIST ("boundary");

ANALYZE "Neighborhood";
