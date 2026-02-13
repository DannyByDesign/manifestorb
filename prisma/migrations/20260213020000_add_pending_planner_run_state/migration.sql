-- Persist multi-turn planner continuation state (clarification workflow)

CREATE TABLE "PendingPlannerRunState" (
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
  "correlationId" TEXT NOT NULL,
  "baseMessage" TEXT NOT NULL,
  "candidateCapabilities" TEXT[] NOT NULL,
  "clarificationPrompt" TEXT,
  "missingFields" TEXT[] NOT NULL,
  "expiresAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "PendingPlannerRunState_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "PendingPlannerRunState_correlationId_key"
  ON "PendingPlannerRunState"("correlationId");

CREATE INDEX "PendingPlannerRunState_userId_status_expiresAt_idx"
  ON "PendingPlannerRunState"("userId", "status", "expiresAt");

CREATE INDEX "PendingPlannerRunState_userId_emailAccountId_status_expiresAt_idx"
  ON "PendingPlannerRunState"("userId", "emailAccountId", "status", "expiresAt");

CREATE INDEX "PendingPlannerRunState_userId_provider_channelId_threadId_status_expiresAt_idx"
  ON "PendingPlannerRunState"("userId", "provider", "channelId", "threadId", "status", "expiresAt");

CREATE INDEX "PendingPlannerRunState_conversationId_status_expiresAt_idx"
  ON "PendingPlannerRunState"("conversationId", "status", "expiresAt");

ALTER TABLE "PendingPlannerRunState"
  ADD CONSTRAINT "PendingPlannerRunState_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "User"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "PendingPlannerRunState"
  ADD CONSTRAINT "PendingPlannerRunState_emailAccountId_fkey"
  FOREIGN KEY ("emailAccountId") REFERENCES "EmailAccount"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;
