-- Add streaming progress + log support to SyncRun.
ALTER TABLE "SyncRun"
  ADD COLUMN "progressMessage" TEXT,
  ADD COLUMN "progressCurrent" INTEGER,
  ADD COLUMN "progressTotal"   INTEGER,
  ADD COLUMN "logs"             JSONB;
