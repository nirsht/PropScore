-- Gmail outreach + reply analysis feature.
-- Purely additive: new enums, new columns, new tables. No existing data is
-- touched, no generated columns / materialized views are affected.

-- CreateEnum
CREATE TYPE "EmailThreadStatus" AS ENUM ('DRAFT', 'SENT', 'REPLIED', 'PARSED', 'FAILED');

-- CreateEnum
CREATE TYPE "EmailDirection" AS ENUM ('OUTBOUND', 'INBOUND');

-- AlterTable: provenance flag for extractedRentRoll
ALTER TABLE "Listing" ADD COLUMN "extractedRentRollSource" TEXT;

-- CreateTable: one thread per (user, listing) outreach
CREATE TABLE "EmailThread" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "listingMlsId" TEXT NOT NULL,
    "gmailThreadId" TEXT,
    "gmailDraftId" TEXT,
    "status" "EmailThreadStatus" NOT NULL DEFAULT 'DRAFT',
    "toEmail" TEXT NOT NULL,
    "subject" TEXT NOT NULL,
    "trigger" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "sentAt" TIMESTAMP(3),
    "lastSyncedAt" TIMESTAMP(3),
    "parsedAt" TIMESTAMP(3),
    "parseError" TEXT,

    CONSTRAINT "EmailThread_pkey" PRIMARY KEY ("id")
);

-- CreateIndex: dedup guarantee — at most one thread per user/listing pair
CREATE UNIQUE INDEX "EmailThread_userId_listingMlsId_key" ON "EmailThread"("userId", "listingMlsId");

-- CreateIndex
CREATE INDEX "EmailThread_status_idx" ON "EmailThread"("status");

-- CreateIndex
CREATE INDEX "EmailThread_userId_createdAt_idx" ON "EmailThread"("userId", "createdAt" DESC);

-- AddForeignKey
ALTER TABLE "EmailThread" ADD CONSTRAINT "EmailThread_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EmailThread" ADD CONSTRAINT "EmailThread_listingMlsId_fkey" FOREIGN KEY ("listingMlsId") REFERENCES "Listing"("mlsId") ON DELETE CASCADE ON UPDATE CASCADE;

-- CreateTable: every Gmail message in a thread (outbound + inbound)
CREATE TABLE "EmailMessage" (
    "id" TEXT NOT NULL,
    "threadId" TEXT NOT NULL,
    "gmailMessageId" TEXT NOT NULL,
    "direction" "EmailDirection" NOT NULL,
    "fromEmail" TEXT NOT NULL,
    "toEmail" TEXT NOT NULL,
    "subject" TEXT NOT NULL,
    "snippet" TEXT,
    "bodyText" TEXT,
    "receivedAt" TIMESTAMP(3) NOT NULL,
    "attachments" JSONB,
    "parsedRentRoll" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "EmailMessage_pkey" PRIMARY KEY ("id")
);

-- CreateIndex: Gmail message ids are globally unique, so any retry is idempotent
CREATE UNIQUE INDEX "EmailMessage_gmailMessageId_key" ON "EmailMessage"("gmailMessageId");

-- CreateIndex
CREATE INDEX "EmailMessage_threadId_receivedAt_idx" ON "EmailMessage"("threadId", "receivedAt");

-- AddForeignKey
ALTER TABLE "EmailMessage" ADD CONSTRAINT "EmailMessage_threadId_fkey" FOREIGN KEY ("threadId") REFERENCES "EmailThread"("id") ON DELETE CASCADE ON UPDATE CASCADE;
