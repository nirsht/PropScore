-- Chat capability: conversations + messages.
-- Two scopes: ASSET (chat about a single Listing) and GLOBAL (chat about
-- the result set, grounded in a frozen FilterInput snapshot).
-- v1 has no user uploads; the chat reads listing photos from raw Bridge
-- Media URLs and grounds answers in the existing Listing/Score/AIEnrichment
-- data. File-attachment plumbing can be added later without breaking these
-- tables.

CREATE TYPE "ChatScope" AS ENUM ('ASSET', 'GLOBAL');
CREATE TYPE "ChatRole" AS ENUM ('USER', 'ASSISTANT', 'TOOL', 'SYSTEM');

CREATE TABLE "ChatConversation" (
    "id"             TEXT NOT NULL,
    "userId"         TEXT NOT NULL,
    "scope"          "ChatScope" NOT NULL,
    "listingMlsId"   TEXT,
    "filterSnapshot" JSONB,
    "title"          TEXT NOT NULL,
    "pinned"         BOOLEAN NOT NULL DEFAULT FALSE,
    "archived"       BOOLEAN NOT NULL DEFAULT FALSE,
    "createdAt"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt"      TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ChatConversation_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "ChatConversation"
    ADD CONSTRAINT "ChatConversation_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "ChatConversation"
    ADD CONSTRAINT "ChatConversation_listingMlsId_fkey"
    FOREIGN KEY ("listingMlsId") REFERENCES "Listing"("mlsId") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE INDEX "ChatConversation_userId_updatedAt_idx"
    ON "ChatConversation" ("userId", "updatedAt" DESC);

CREATE INDEX "ChatConversation_userId_scope_listingMlsId_idx"
    ON "ChatConversation" ("userId", "scope", "listingMlsId");

CREATE TABLE "ChatMessage" (
    "id"             TEXT NOT NULL,
    "conversationId" TEXT NOT NULL,
    "role"           "ChatRole" NOT NULL,
    "content"        TEXT NOT NULL,
    "toolCalls"      JSONB,
    "toolName"       TEXT,
    "toolCallId"     TEXT,
    "citedMlsIds"    TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
    "tokensIn"       INTEGER,
    "tokensOut"      INTEGER,
    "errored"        BOOLEAN NOT NULL DEFAULT FALSE,
    "createdAt"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ChatMessage_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "ChatMessage"
    ADD CONSTRAINT "ChatMessage_conversationId_fkey"
    FOREIGN KEY ("conversationId") REFERENCES "ChatConversation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE INDEX "ChatMessage_conversationId_createdAt_idx"
    ON "ChatMessage" ("conversationId", "createdAt");
