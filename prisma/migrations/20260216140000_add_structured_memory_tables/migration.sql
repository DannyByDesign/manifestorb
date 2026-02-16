-- Structured memory schema for episodic + relationship recall.

CREATE TABLE IF NOT EXISTS "PersonMemory" (
  "id" TEXT PRIMARY KEY,
  "userId" TEXT NOT NULL,
  "displayName" TEXT NOT NULL,
  "normalizedName" TEXT NOT NULL,
  "metadata" JSONB,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "PersonMemory_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE
);

CREATE UNIQUE INDEX IF NOT EXISTS "PersonMemory_userId_normalizedName_key"
  ON "PersonMemory"("userId", "normalizedName");
CREATE INDEX IF NOT EXISTS "PersonMemory_userId_idx"
  ON "PersonMemory"("userId");

CREATE TABLE IF NOT EXISTS "InteractionEpisode" (
  "id" TEXT PRIMARY KEY,
  "userId" TEXT NOT NULL,
  "title" TEXT,
  "summary" TEXT,
  "sourceConversationId" TEXT,
  "sourceEmailThreadId" TEXT,
  "sourceCalendarEventId" TEXT,
  "startedAt" TIMESTAMP(3),
  "endedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "InteractionEpisode_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE,
  CONSTRAINT "InteractionEpisode_sourceConversationId_fkey"
    FOREIGN KEY ("sourceConversationId") REFERENCES "Conversation"("id") ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS "InteractionEpisode_userId_createdAt_idx"
  ON "InteractionEpisode"("userId", "createdAt");
CREATE INDEX IF NOT EXISTS "InteractionEpisode_userId_sourceEmailThreadId_idx"
  ON "InteractionEpisode"("userId", "sourceEmailThreadId");

CREATE TABLE IF NOT EXISTS "EpisodeParticipant" (
  "id" TEXT PRIMARY KEY,
  "episodeId" TEXT NOT NULL,
  "personId" TEXT NOT NULL,
  "role" TEXT,
  "mentionCount" INTEGER NOT NULL DEFAULT 1,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "EpisodeParticipant_episodeId_fkey"
    FOREIGN KEY ("episodeId") REFERENCES "InteractionEpisode"("id") ON DELETE CASCADE,
  CONSTRAINT "EpisodeParticipant_personId_fkey"
    FOREIGN KEY ("personId") REFERENCES "PersonMemory"("id") ON DELETE CASCADE
);

CREATE UNIQUE INDEX IF NOT EXISTS "EpisodeParticipant_episodeId_personId_key"
  ON "EpisodeParticipant"("episodeId", "personId");
CREATE INDEX IF NOT EXISTS "EpisodeParticipant_personId_idx"
  ON "EpisodeParticipant"("personId");

CREATE TABLE IF NOT EXISTS "RelationshipAssertion" (
  "id" TEXT PRIMARY KEY,
  "userId" TEXT NOT NULL,
  "personId" TEXT NOT NULL,
  "relatedPersonId" TEXT,
  "relationType" TEXT NOT NULL,
  "assertion" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'ACTIVE',
  "confidence" DOUBLE PRECISION NOT NULL DEFAULT 0.8,
  "evidenceSnippet" TEXT,
  "sourceMessageId" TEXT,
  "episodeId" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "RelationshipAssertion_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE,
  CONSTRAINT "RelationshipAssertion_personId_fkey"
    FOREIGN KEY ("personId") REFERENCES "PersonMemory"("id") ON DELETE CASCADE,
  CONSTRAINT "RelationshipAssertion_relatedPersonId_fkey"
    FOREIGN KEY ("relatedPersonId") REFERENCES "PersonMemory"("id") ON DELETE SET NULL,
  CONSTRAINT "RelationshipAssertion_sourceMessageId_fkey"
    FOREIGN KEY ("sourceMessageId") REFERENCES "ConversationMessage"("id") ON DELETE SET NULL,
  CONSTRAINT "RelationshipAssertion_episodeId_fkey"
    FOREIGN KEY ("episodeId") REFERENCES "InteractionEpisode"("id") ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS "RelationshipAssertion_userId_personId_idx"
  ON "RelationshipAssertion"("userId", "personId", "createdAt");
CREATE INDEX IF NOT EXISTS "RelationshipAssertion_userId_status_idx"
  ON "RelationshipAssertion"("userId", "status", "updatedAt");

CREATE TABLE IF NOT EXISTS "CommitmentMemory" (
  "id" TEXT PRIMARY KEY,
  "userId" TEXT NOT NULL,
  "personId" TEXT,
  "description" TEXT NOT NULL,
  "owner" TEXT NOT NULL DEFAULT 'user',
  "status" TEXT NOT NULL DEFAULT 'OPEN',
  "dueAt" TIMESTAMP(3),
  "confidence" DOUBLE PRECISION NOT NULL DEFAULT 0.8,
  "evidenceSnippet" TEXT,
  "sourceMessageId" TEXT,
  "episodeId" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "resolvedAt" TIMESTAMP(3),
  CONSTRAINT "CommitmentMemory_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE,
  CONSTRAINT "CommitmentMemory_personId_fkey"
    FOREIGN KEY ("personId") REFERENCES "PersonMemory"("id") ON DELETE SET NULL,
  CONSTRAINT "CommitmentMemory_sourceMessageId_fkey"
    FOREIGN KEY ("sourceMessageId") REFERENCES "ConversationMessage"("id") ON DELETE SET NULL,
  CONSTRAINT "CommitmentMemory_episodeId_fkey"
    FOREIGN KEY ("episodeId") REFERENCES "InteractionEpisode"("id") ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS "CommitmentMemory_userId_status_dueAt_idx"
  ON "CommitmentMemory"("userId", "status", "dueAt");
CREATE INDEX IF NOT EXISTS "CommitmentMemory_userId_updatedAt_idx"
  ON "CommitmentMemory"("userId", "updatedAt");

CREATE TABLE IF NOT EXISTS "MemoryEvidence" (
  "id" TEXT PRIMARY KEY,
  "userId" TEXT NOT NULL,
  "sourceMessageId" TEXT,
  "excerpt" TEXT NOT NULL,
  "evidenceHash" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "MemoryEvidence_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE,
  CONSTRAINT "MemoryEvidence_sourceMessageId_fkey"
    FOREIGN KEY ("sourceMessageId") REFERENCES "ConversationMessage"("id") ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS "MemoryEvidence_userId_createdAt_idx"
  ON "MemoryEvidence"("userId", "createdAt");

CREATE TABLE IF NOT EXISTS "MemoryAccessAudit" (
  "id" TEXT PRIMARY KEY,
  "userId" TEXT NOT NULL,
  "surface" TEXT,
  "query" TEXT,
  "accessType" TEXT NOT NULL,
  "resultCount" INTEGER,
  "metadata" JSONB,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "MemoryAccessAudit_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS "MemoryAccessAudit_userId_createdAt_idx"
  ON "MemoryAccessAudit"("userId", "createdAt");
