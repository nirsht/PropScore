-- CreateTable
CREATE TABLE IF NOT EXISTS "ListingDocument" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "listingMlsId" TEXT NOT NULL,
    "filename" TEXT NOT NULL,
    "mimeType" TEXT NOT NULL,
    "size" INTEGER NOT NULL,
    "content" BYTEA NOT NULL,
    "parsedRentRoll" JSONB,
    "parseError" TEXT,
    "parsedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ListingDocument_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX IF NOT EXISTS "ListingDocument_listingMlsId_createdAt_idx" ON "ListingDocument"("listingMlsId", "createdAt" DESC);

-- CreateIndex
CREATE INDEX IF NOT EXISTS "ListingDocument_userId_createdAt_idx" ON "ListingDocument"("userId", "createdAt" DESC);

-- AddForeignKey
DO $$ BEGIN
    ALTER TABLE "ListingDocument" ADD CONSTRAINT "ListingDocument_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN null; END $$;

-- AddForeignKey
DO $$ BEGIN
    ALTER TABLE "ListingDocument" ADD CONSTRAINT "ListingDocument_listingMlsId_fkey" FOREIGN KEY ("listingMlsId") REFERENCES "Listing"("mlsId") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN null; END $$;
