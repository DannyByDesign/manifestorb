-- Persist multi-turn skill continuation state (slot clarification workflow)

CREATE TABLE "PendingSkillRunState" (
  "id" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "userId" TEXT NOT NULL,
  "emailAccountId" TEXT NOT NULL,
  "provider" TEXT NOT NULL,
  "conversationId" TEXT,
  "channelId" TEXT,
  "threadId" TEXT,
  "status" TEXT NOT NULL DEFAULT 'PENDING',
  "skillId" TEXT NOT NULL,
  "correlationId" TEXT NOT NULL,
  "resolvedSlots" JSONB NOT NULL,
  "missingSlots" TEXT[] NOT NULL,
  "ambiguousSlots" TEXT[] NOT NULL,
  "clarificationPrompt" TEXT,
  "expiresAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "PendingSkillRunState_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "PendingSkillRunState_correlationId_key"
  ON "PendingSkillRunState"("correlationId");

CREATE INDEX "PendingSkillRunState_userId_status_expiresAt_idx"
  ON "PendingSkillRunState"("userId", "status", "expiresAt");

CREATE INDEX "PendingSkillRunState_userId_emailAccountId_status_expiresAt_idx"
  ON "PendingSkillRunState"("userId", "emailAccountId", "status", "expiresAt");

CREATE INDEX "PendingSkillRunState_userId_provider_channelId_threadId_status_expiresAt_idx"
  ON "PendingSkillRunState"("userId", "provider", "channelId", "threadId", "status", "expiresAt");

CREATE INDEX "PendingSkillRunState_conversationId_status_expiresAt_idx"
  ON "PendingSkillRunState"("conversationId", "status", "expiresAt");

ALTER TABLE "PendingSkillRunState"
  ADD CONSTRAINT "PendingSkillRunState_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "User"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "PendingSkillRunState"
  ADD CONSTRAINT "PendingSkillRunState_emailAccountId_fkey"
  FOREIGN KEY ("emailAccountId") REFERENCES "EmailAccount"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;
