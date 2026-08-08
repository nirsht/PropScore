-- Move EmailThread dedup from per-(user, listing) to per-listing (team-wide).
-- Once anyone on the team has a thread for a listing, nobody drafts a second
-- one; `userId` now means "who owns/sent this thread".

-- Collapse any pre-existing duplicate threads for the same listing, keeping the
-- earliest (its messages cascade-delete with it). In practice there is at most
-- one real user today, so this is a no-op safety net rather than a data change.
DELETE FROM "EmailThread" t
USING "EmailThread" keep
WHERE t."listingMlsId" = keep."listingMlsId"
  AND (
    t."createdAt" > keep."createdAt"
    OR (t."createdAt" = keep."createdAt" AND t."id" > keep."id")
  );

-- Swap the composite unique for a per-listing unique.
DROP INDEX IF EXISTS "EmailThread_userId_listingMlsId_key";
CREATE UNIQUE INDEX IF NOT EXISTS "EmailThread_listingMlsId_key" ON "EmailThread"("listingMlsId");
