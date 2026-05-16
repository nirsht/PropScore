-- Add a fingerprint of the AI-scoring input payload to Score so the
-- nightly delta-AI job can skip listings whose inputs haven't changed
-- since the last AI run. Null = never AI-scored (the first nightly will
-- score every row).
ALTER TABLE "Score" ADD COLUMN "aiInputHash" TEXT;
