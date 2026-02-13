-- Unified rule plane foundational tables for canonical rules + policy logs

CREATE TABLE "CanonicalRule" (
  "id" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "version" INTEGER NOT NULL DEFAULT 1,
  "type" TEXT NOT NULL,
  "enabled" BOOLEAN NOT NULL DEFAULT true,
  "priority" INTEGER NOT NULL DEFAULT 0,
  "name" TEXT,
  "description" TEXT,
  "scope" JSONB,
  "match" JSONB NOT NULL,
  "trigger" JSONB,
  "decision" TEXT,
  "transform" JSONB,
  "actionPlan" JSONB,
  "preferencePatch" JSONB,
  "expiresAt" TIMESTAMP(3),
  "disabledUntil" TIMESTAMP(3),
  "sourceMode" TEXT NOT NULL DEFAULT 'system',
  "sourceNl" TEXT,
  "sourceMessageId" TEXT,
  "sourceConversationId" TEXT,
  "compilerVersion" TEXT,
  "compilerConfidence" DOUBLE PRECISION,
  "compilerWarnings" JSONB,
  "legacyRefType" TEXT,
  "legacyRefId" TEXT,
  "userId" TEXT NOT NULL,
  "emailAccountId" TEXT,

  CONSTRAINT "CanonicalRule_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "CanonicalRuleVersion" (
  "id" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "canonicalRuleId" TEXT NOT NULL,
  "version" INTEGER NOT NULL,
  "payload" JSONB NOT NULL,
  "sourceMode" TEXT,

  CONSTRAINT "CanonicalRuleVersion_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "PolicyDecisionLog" (
  "id" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "userId" TEXT NOT NULL,
  "emailAccountId" TEXT,
  "canonicalRuleId" TEXT,
  "source" TEXT NOT NULL,
  "toolName" TEXT NOT NULL,
  "mutationResource" TEXT,
  "mutationOperation" TEXT,
  "args" JSONB NOT NULL,
  "decisionKind" TEXT NOT NULL,
  "reasonCode" TEXT NOT NULL,
  "message" TEXT NOT NULL,
  "requiresApproval" BOOLEAN NOT NULL DEFAULT false,
  "approvalPayload" JSONB,
  "transformedArgs" JSONB,
  "correlationId" TEXT,
  "conversationId" TEXT,
  "channelId" TEXT,
  "threadId" TEXT,
  "messageId" TEXT,

  CONSTRAINT "PolicyDecisionLog_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "PolicyExecutionLog" (
  "id" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "userId" TEXT NOT NULL,
  "emailAccountId" TEXT,
  "policyDecisionLogId" TEXT,
  "source" TEXT NOT NULL,
  "toolName" TEXT NOT NULL,
  "mutationResource" TEXT,
  "mutationOperation" TEXT,
  "args" JSONB NOT NULL,
  "outcome" TEXT NOT NULL,
  "result" JSONB,
  "error" TEXT,
  "correlationId" TEXT,
  "conversationId" TEXT,
  "channelId" TEXT,
  "threadId" TEXT,
  "messageId" TEXT,

  CONSTRAINT "PolicyExecutionLog_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "CanonicalRuleVersion_canonicalRuleId_version_key"
  ON "CanonicalRuleVersion"("canonicalRuleId", "version");

CREATE INDEX "CanonicalRule_userId_type_enabled_priority_idx"
  ON "CanonicalRule"("userId", "type", "enabled", "priority");

CREATE INDEX "CanonicalRule_emailAccountId_type_enabled_priority_idx"
  ON "CanonicalRule"("emailAccountId", "type", "enabled", "priority");

CREATE INDEX "CanonicalRule_legacyRefType_legacyRefId_idx"
  ON "CanonicalRule"("legacyRefType", "legacyRefId");

CREATE INDEX "CanonicalRuleVersion_createdAt_idx"
  ON "CanonicalRuleVersion"("createdAt");

CREATE INDEX "PolicyDecisionLog_userId_createdAt_idx"
  ON "PolicyDecisionLog"("userId", "createdAt");

CREATE INDEX "PolicyDecisionLog_emailAccountId_createdAt_idx"
  ON "PolicyDecisionLog"("emailAccountId", "createdAt");

CREATE INDEX "PolicyDecisionLog_decisionKind_createdAt_idx"
  ON "PolicyDecisionLog"("decisionKind", "createdAt");

CREATE INDEX "PolicyDecisionLog_correlationId_createdAt_idx"
  ON "PolicyDecisionLog"("correlationId", "createdAt");

CREATE INDEX "PolicyExecutionLog_userId_createdAt_idx"
  ON "PolicyExecutionLog"("userId", "createdAt");

CREATE INDEX "PolicyExecutionLog_emailAccountId_createdAt_idx"
  ON "PolicyExecutionLog"("emailAccountId", "createdAt");

CREATE INDEX "PolicyExecutionLog_outcome_createdAt_idx"
  ON "PolicyExecutionLog"("outcome", "createdAt");

CREATE INDEX "PolicyExecutionLog_correlationId_createdAt_idx"
  ON "PolicyExecutionLog"("correlationId", "createdAt");

ALTER TABLE "CanonicalRule"
  ADD CONSTRAINT "CanonicalRule_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "User"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "CanonicalRule"
  ADD CONSTRAINT "CanonicalRule_emailAccountId_fkey"
  FOREIGN KEY ("emailAccountId") REFERENCES "EmailAccount"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "CanonicalRuleVersion"
  ADD CONSTRAINT "CanonicalRuleVersion_canonicalRuleId_fkey"
  FOREIGN KEY ("canonicalRuleId") REFERENCES "CanonicalRule"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "PolicyDecisionLog"
  ADD CONSTRAINT "PolicyDecisionLog_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "User"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "PolicyDecisionLog"
  ADD CONSTRAINT "PolicyDecisionLog_emailAccountId_fkey"
  FOREIGN KEY ("emailAccountId") REFERENCES "EmailAccount"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "PolicyDecisionLog"
  ADD CONSTRAINT "PolicyDecisionLog_canonicalRuleId_fkey"
  FOREIGN KEY ("canonicalRuleId") REFERENCES "CanonicalRule"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "PolicyExecutionLog"
  ADD CONSTRAINT "PolicyExecutionLog_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "User"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "PolicyExecutionLog"
  ADD CONSTRAINT "PolicyExecutionLog_emailAccountId_fkey"
  FOREIGN KEY ("emailAccountId") REFERENCES "EmailAccount"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "PolicyExecutionLog"
  ADD CONSTRAINT "PolicyExecutionLog_policyDecisionLogId_fkey"
  FOREIGN KEY ("policyDecisionLogId") REFERENCES "PolicyDecisionLog"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;
