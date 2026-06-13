-- DBI Inspection Complaints (Socrata 9c7e-yn3d). Per-parcel rollup joined to
-- Listing on canonical block||lot. Superset of NOVs — most public complaints
-- never escalate to a Notice of Violation, so this captures complaint
-- pressure (habitability gripes, work-without-permit reports, etc.) that the
-- existing codeViolations* feed misses. Display-only on the
-- RiskComplianceCard; not added to mv_listing_search (no filter UI).
--
-- Open count = `date_abated IS NULL` AND status not in {abated,closed,complete}.
-- Recent count = 5y window on `last_inspection_date` (dataset's freshness proxy
-- — there is no explicit "date filed" column).

ALTER TABLE "Listing"
  ADD COLUMN "dbiComplaintsOpenCount"    INTEGER,
  ADD COLUMN "dbiComplaintsRecentCount"  INTEGER,
  ADD COLUMN "dbiComplaintsLatest"       JSONB,
  ADD COLUMN "dbiComplaintsFetchedAt"    TIMESTAMP(3);
