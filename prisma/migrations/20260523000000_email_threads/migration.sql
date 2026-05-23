-- CreateEnum
DO $$ BEGIN
    CREATE TYPE "EmailThreadStatus" AS ENUM ('DRAFT', 'SENT', 'REPLIED', 'PARSED', 'FAILED');
EXCEPTION WHEN duplicate_object THEN null; END $$;

-- CreateEnum
DO $$ BEGIN
    CREATE TYPE "EmailDirection" AS ENUM ('OUTBOUND', 'INBOUND');
EXCEPTION WHEN duplicate_object THEN null; END $$;

-- CreateTable
CREATE TABLE IF NOT EXISTS "EmailThread" (
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

-- CreateTable
CREATE TABLE IF NOT EXISTS "EmailMessage" (
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

-- CreateIndex
CREATE INDEX IF NOT EXISTS "EmailThread_status_idx" ON "EmailThread"("status");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "EmailThread_userId_createdAt_idx" ON "EmailThread"("userId", "createdAt" DESC);

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "EmailThread_userId_listingMlsId_key" ON "EmailThread"("userId", "listingMlsId");

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "EmailMessage_gmailMessageId_key" ON "EmailMessage"("gmailMessageId");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "EmailMessage_threadId_receivedAt_idx" ON "EmailMessage"("threadId", "receivedAt");

-- AddForeignKey
DO $$ BEGIN
    ALTER TABLE "EmailThread" ADD CONSTRAINT "EmailThread_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN null; END $$;

-- AddForeignKey
DO $$ BEGIN
    ALTER TABLE "EmailThread" ADD CONSTRAINT "EmailThread_listingMlsId_fkey" FOREIGN KEY ("listingMlsId") REFERENCES "Listing"("mlsId") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN null; END $$;

-- AddForeignKey
DO $$ BEGIN
    ALTER TABLE "EmailMessage" ADD CONSTRAINT "EmailMessage_threadId_fkey" FOREIGN KEY ("threadId") REFERENCES "EmailThread"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN null; END $$;
