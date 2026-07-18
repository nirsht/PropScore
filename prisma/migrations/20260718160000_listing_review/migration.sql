-- CreateEnum
CREATE TYPE "DealStatus" AS ENUM ('NEW', 'IN_REVIEW', 'SUBMIT_OFFER', 'PASS');

-- CreateTable
CREATE TABLE "ListingReview" (
    "listingMlsId" TEXT NOT NULL,
    "dealStatus" "DealStatus" NOT NULL DEFAULT 'NEW',
    "note" TEXT,
    "agentName" TEXT,
    "agentEmail" TEXT,
    "agentPhone" TEXT,
    "officeName" TEXT,
    "updatedByUserId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ListingReview_pkey" PRIMARY KEY ("listingMlsId")
);

-- CreateIndex
CREATE INDEX "ListingReview_dealStatus_idx" ON "ListingReview"("dealStatus");

-- AddForeignKey
ALTER TABLE "ListingReview" ADD CONSTRAINT "ListingReview_listingMlsId_fkey" FOREIGN KEY ("listingMlsId") REFERENCES "Listing"("mlsId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ListingReview" ADD CONSTRAINT "ListingReview_updatedByUserId_fkey" FOREIGN KEY ("updatedByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
