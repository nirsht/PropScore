-- StarredListing: per-user favorites join table for the "Save" feature.
-- Lets a user star listings from the grid / drawer and later filter the
-- search to "saved only" via FilterInput.starredOnly. Mirrors SavedFilter
-- in shape (small, user-keyed, indexed by createdAt desc for recency).

CREATE TABLE "StarredListing" (
    "userId"       TEXT NOT NULL,
    "listingMlsId" TEXT NOT NULL,
    "createdAt"    TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "StarredListing_pkey" PRIMARY KEY ("userId", "listingMlsId")
);

CREATE INDEX "StarredListing_userId_createdAt_idx"
  ON "StarredListing"("userId", "createdAt" DESC);

ALTER TABLE "StarredListing"
  ADD CONSTRAINT "StarredListing_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "User"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "StarredListing"
  ADD CONSTRAINT "StarredListing_listingMlsId_fkey"
  FOREIGN KEY ("listingMlsId") REFERENCES "Listing"("mlsId")
  ON DELETE CASCADE ON UPDATE CASCADE;
