-- Create unified pending runtime state model
CREATE TABLE "PendingAgentTurnState" (
  "id" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  "userId" TEXT NOT NULL,
  "emailAccountId" TEXT NOT NULL,
  "provider" TEXT NOT NULL,
  "conversationId" TEXT,
  "channelId" TEXT,
  "threadId" TEXT,
  "status" TEXT NOT NULL DEFAULT 'PENDING',
  "pendingType" TEXT NOT NULL DEFAULT 'clarification',
  "correlationId" TEXT NOT NULL,
  "payload" JSONB NOT NULL,
  "expiresAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "PendingAgentTurnState_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "PendingAgentTurnState_correlationId_key"
  ON "PendingAgentTurnState"("correlationId");

CREATE INDEX "PendingAgentTurnState_userId_status_expiresAt_idx"
  ON "PendingAgentTurnState"("userId", "status", "expiresAt");

CREATE INDEX "PendingAgentTurnState_userId_emailAccountId_status_expiresAt_idx"
  ON "PendingAgentTurnState"("userId", "emailAccountId", "status", "expiresAt");

CREATE INDEX "PendingAgentTurnState_userId_provider_channelId_threadId_status_expiresAt_idx"
  ON "PendingAgentTurnState"("userId", "provider", "channelId", "threadId", "status", "expiresAt");

CREATE INDEX "PendingAgentTurnState_conversationId_status_expiresAt_idx"
  ON "PendingAgentTurnState"("conversationId", "status", "expiresAt");

ALTER TABLE "PendingAgentTurnState"
  ADD CONSTRAINT "PendingAgentTurnState_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "User"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "PendingAgentTurnState"
  ADD CONSTRAINT "PendingAgentTurnState_emailAccountId_fkey"
  FOREIGN KEY ("emailAccountId") REFERENCES "EmailAccount"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

-- Backfill approval preferences into canonical preference rules
INSERT INTO "CanonicalRule" (
  "id",
  "createdAt",
  "updatedAt",
  "version",
  "type",
  "enabled",
  "priority",
  "name",
  "match",
  "decision",
  "preferencePatch",
  "sourceMode",
  "legacyRefType",
  "legacyRefId",
  "userId"
)
SELECT
  concat('apref_', ap."id") AS "id",
  ap."createdAt",
  ap."updatedAt",
  1 AS "version",
  'preference' AS "type",
  true AS "enabled",
  0 AS "priority",
  concat('approval:', ap."toolName") AS "name",
  '{}'::jsonb AS "match",
  ap."policy" AS "decision",
  ap."conditions" AS "preferencePatch",
  'migration' AS "sourceMode",
  'ApprovalPreference' AS "legacyRefType",
  ap."id" AS "legacyRefId",
  ap."userId"
FROM "ApprovalPreference" ap
WHERE NOT EXISTS (
  SELECT 1
  FROM "CanonicalRule" cr
  WHERE cr."userId" = ap."userId"
    AND cr."type" = 'preference'
    AND cr."name" = concat('approval:', ap."toolName")
);

-- Backfill from legacy pending models
INSERT INTO "PendingAgentTurnState" (
  "id",
  "createdAt",
  "updatedAt",
  "userId",
  "emailAccountId",
  "provider",
  "conversationId",
  "channelId",
  "threadId",
  "status",
  "pendingType",
  "correlationId",
  "payload",
  "expiresAt"
)
SELECT
  "id",
  "createdAt",
  "updatedAt",
  "userId",
  "emailAccountId",
  "provider",
  "conversationId",
  "channelId",
  "threadId",
  "status",
  'clarification' AS "pendingType",
  "correlationId",
  jsonb_build_object(
    'skillId', "skillId",
    'resolvedSlots', "resolvedSlots",
    'missingSlots', "missingSlots",
    'ambiguousSlots', "ambiguousSlots",
    'clarificationPrompt', "clarificationPrompt"
  ) AS "payload",
  "expiresAt"
FROM "PendingSkillRunState";

INSERT INTO "PendingAgentTurnState" (
  "id",
  "createdAt",
  "updatedAt",
  "userId",
  "emailAccountId",
  "provider",
  "conversationId",
  "channelId",
  "threadId",
  "status",
  "pendingType",
  "correlationId",
  "payload",
  "expiresAt"
)
SELECT
  concat('planner_', "id"),
  "createdAt",
  "updatedAt",
  "userId",
  "emailAccountId",
  "provider",
  "conversationId",
  "channelId",
  "threadId",
  "status",
  'clarification' AS "pendingType",
  concat("correlationId", '-planner') AS "correlationId",
  jsonb_build_object(
    'baseMessage', "baseMessage",
    'candidateCapabilities', "candidateCapabilities",
    'clarificationPrompt', "clarificationPrompt",
    'missingFields', "missingFields"
  ) AS "payload",
  "expiresAt"
FROM "PendingPlannerRunState";

-- Backfill calendar policies into canonical guardrail rules
INSERT INTO "CanonicalRule" (
  "id",
  "createdAt",
  "updatedAt",
  "version",
  "type",
  "enabled",
  "priority",
  "name",
  "scope",
  "match",
  "decision",
  "transform",
  "expiresAt",
  "disabledUntil",
  "sourceMode",
  "legacyRefType",
  "legacyRefId",
  "userId",
  "emailAccountId"
)
SELECT
  concat('calpol_', cep."id") AS "id",
  cep."createdAt",
  cep."updatedAt",
  1 AS "version",
  'guardrail' AS "type",
  true AS "enabled",
  cep."priority",
  COALESCE(cep."title", concat('Calendar policy ', left(cep."id", 8))) AS "name",
  jsonb_build_object(
    'surfaces', '[]'::jsonb,
    'resources', jsonb_build_array('calendar')
  ) AS "scope",
  jsonb_build_object(
    'resource', 'calendar',
    'operation', 'calendar_policy',
    'conditions',
      COALESCE(
        (
          SELECT jsonb_agg(condition_entry)
          FROM (
            VALUES
              (
                CASE
                  WHEN cep."shadowEventId" IS NOT NULL
                  THEN jsonb_build_object(
                    'field', 'target.shadowEventId',
                    'op', 'eq',
                    'value', cep."shadowEventId"
                  )
                  ELSE NULL
                END
              ),
              (
                CASE
                  WHEN cep."criteria" ? 'provider'
                  THEN jsonb_build_object(
                    'field', 'target.provider',
                    'op', 'eq',
                    'value', cep."criteria"->>'provider'
                  )
                  ELSE NULL
                END
              ),
              (
                CASE
                  WHEN cep."criteria" ? 'calendarId'
                  THEN jsonb_build_object(
                    'field', 'target.calendarId',
                    'op', 'eq',
                    'value', cep."criteria"->>'calendarId'
                  )
                  ELSE NULL
                END
              ),
              (
                CASE
                  WHEN cep."criteria" ? 'iCalUid'
                  THEN jsonb_build_object(
                    'field', 'target.iCalUid',
                    'op', 'eq',
                    'value', cep."criteria"->>'iCalUid'
                  )
                  ELSE NULL
                END
              ),
              (
                CASE
                  WHEN cep."criteria" ? 'titleContains'
                  THEN jsonb_build_object(
                    'field', 'target.title',
                    'op', 'contains',
                    'value', cep."criteria"->>'titleContains'
                  )
                  ELSE NULL
                END
              )
          ) AS entries(condition_entry)
          WHERE condition_entry IS NOT NULL
        ),
        '[]'::jsonb
      )
  ) AS "match",
  'allow_with_transform' AS "decision",
  jsonb_build_object(
    'patch',
      jsonb_build_array(
        jsonb_build_object('path', 'calendarPolicy.reschedulePolicy', 'value', cep."reschedulePolicy"),
        jsonb_build_object('path', 'calendarPolicy.notifyOnAutoMove', 'value', cep."notifyOnAutoMove"),
        jsonb_build_object('path', 'calendarPolicy.isProtected', 'value', cep."isProtected"),
        jsonb_build_object(
          'path',
          'calendarPolicy.source',
          'value',
          CASE WHEN cep."source" = 'default' THEN 'event' ELSE 'rule' END
        )
      ),
    'reason', 'Migrated calendar policy rule'
  ) AS "transform",
  cep."expiresAt",
  cep."disabledUntil",
  'migration' AS "sourceMode",
  'CalendarEventPolicy' AS "legacyRefType",
  cep."id" AS "legacyRefId",
  cep."userId",
  cep."emailAccountId"
FROM "CalendarEventPolicy" cep
WHERE NOT EXISTS (
  SELECT 1
  FROM "CanonicalRule" cr
  WHERE cr."legacyRefType" = 'CalendarEventPolicy'
    AND cr."legacyRefId" = cep."id"
);

DROP TABLE "ApprovalPreference";
DROP TABLE "PendingSkillRunState";
DROP TABLE "PendingPlannerRunState";
DROP TABLE "RuleHistory";
DROP TABLE "CalendarEventPolicy";
