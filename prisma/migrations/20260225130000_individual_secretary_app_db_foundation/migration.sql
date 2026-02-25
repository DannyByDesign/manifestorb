-- Individual secretary application database foundation.
-- Adds user-scoped identity/channel, unified conversation mapping, preference/directive,
-- action policy, usage/limits, retention policy tables, and baseline RLS scaffolding.

-- -----------------------------------------------------------------------------
-- User columns
-- -----------------------------------------------------------------------------

ALTER TABLE "User"
  ADD COLUMN IF NOT EXISTS "workosSubject" TEXT,
  ADD COLUMN IF NOT EXISTS "planCode" TEXT NOT NULL DEFAULT 'starter_10_usd';

CREATE UNIQUE INDEX IF NOT EXISTS "User_workosSubject_key" ON "User"("workosSubject");

-- -----------------------------------------------------------------------------
-- Identity and unified conversation tables
-- -----------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS "UserChannelIdentity" (
  "id" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  "userId" TEXT NOT NULL,
  "provider" TEXT NOT NULL,
  "externalUserKey" TEXT NOT NULL,
  "verifiedAt" TIMESTAMP(3),
  "metadata" JSONB,
  CONSTRAINT "UserChannelIdentity_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "UserChannelIdentity_provider_externalUserKey_key"
  ON "UserChannelIdentity"("provider", "externalUserKey");
CREATE INDEX IF NOT EXISTS "UserChannelIdentity_userId_provider_idx"
  ON "UserChannelIdentity"("userId", "provider");

CREATE TABLE IF NOT EXISTS "UnifiedConversation" (
  "id" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  "userId" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'active',
  "title" TEXT,
  "retentionMode" TEXT NOT NULL DEFAULT 'keep_active_tail',
  CONSTRAINT "UnifiedConversation_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "UnifiedConversation_userId_updatedAt_idx"
  ON "UnifiedConversation"("userId", "updatedAt");

CREATE TABLE IF NOT EXISTS "UnifiedConversationLink" (
  "id" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  "unifiedConversationId" TEXT NOT NULL,
  "conversationId" TEXT NOT NULL,
  "provider" TEXT NOT NULL,
  "channelId" TEXT,
  "threadId" TEXT,
  CONSTRAINT "UnifiedConversationLink_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "UnifiedConversationLink_conversationId_key"
  ON "UnifiedConversationLink"("conversationId");
CREATE UNIQUE INDEX IF NOT EXISTS "UnifiedConversationLink_unifiedConversationId_provider_channelId_threadId_key"
  ON "UnifiedConversationLink"("unifiedConversationId", "provider", "channelId", "threadId");
CREATE INDEX IF NOT EXISTS "UnifiedConversationLink_unifiedConversationId_updatedAt_idx"
  ON "UnifiedConversationLink"("unifiedConversationId", "updatedAt");

-- -----------------------------------------------------------------------------
-- Preferences, directives, and action policies
-- -----------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS "UserPreference" (
  "id" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  "userId" TEXT NOT NULL,
  "namespace" TEXT NOT NULL DEFAULT 'general',
  "key" TEXT NOT NULL,
  "value" JSONB NOT NULL,
  "source" TEXT NOT NULL DEFAULT 'user',
  CONSTRAINT "UserPreference_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "UserPreference_userId_namespace_key_key"
  ON "UserPreference"("userId", "namespace", "key");
CREATE INDEX IF NOT EXISTS "UserPreference_userId_namespace_idx"
  ON "UserPreference"("userId", "namespace");

CREATE TABLE IF NOT EXISTS "UserDirective" (
  "id" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  "userId" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'active',
  "directiveText" TEXT NOT NULL,
  "normalized" JSONB,
  "sourceConversationId" TEXT,
  "sourceMessageId" TEXT,
  "compiledRuleId" TEXT,
  "confidence" DOUBLE PRECISION,
  "createdBy" TEXT NOT NULL DEFAULT 'user_nl',
  "expiresAt" TIMESTAMP(3),
  "deletedAt" TIMESTAMP(3),
  CONSTRAINT "UserDirective_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "UserDirective_userId_status_createdAt_idx"
  ON "UserDirective"("userId", "status", "createdAt");
CREATE INDEX IF NOT EXISTS "UserDirective_sourceConversationId_createdAt_idx"
  ON "UserDirective"("sourceConversationId", "createdAt");

CREATE TABLE IF NOT EXISTS "UserActionPolicy" (
  "id" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  "userId" TEXT NOT NULL,
  "actionType" TEXT NOT NULL,
  "requiresApproval" BOOLEAN NOT NULL DEFAULT false,
  "policySource" TEXT NOT NULL DEFAULT 'system_default',
  "metadata" JSONB,
  CONSTRAINT "UserActionPolicy_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "UserActionPolicy_userId_actionType_key"
  ON "UserActionPolicy"("userId", "actionType");
CREATE INDEX IF NOT EXISTS "UserActionPolicy_userId_requiresApproval_idx"
  ON "UserActionPolicy"("userId", "requiresApproval");

-- -----------------------------------------------------------------------------
-- Usage, limits, and retention policy
-- -----------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS "UsageLedger" (
  "id" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "userId" TEXT NOT NULL,
  "conversationId" TEXT,
  "provider" TEXT,
  "model" TEXT,
  "direction" TEXT NOT NULL DEFAULT 'runtime_turn',
  "inputTokens" INTEGER NOT NULL DEFAULT 0,
  "outputTokens" INTEGER NOT NULL DEFAULT 0,
  "totalTokens" INTEGER NOT NULL DEFAULT 0,
  "estimatedCostUsd" DECIMAL(12,6),
  "monthBucket" TIMESTAMP(3) NOT NULL,
  "metadata" JSONB,
  CONSTRAINT "UsageLedger_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "UsageLedger_userId_monthBucket_createdAt_idx"
  ON "UsageLedger"("userId", "monthBucket", "createdAt");
CREATE INDEX IF NOT EXISTS "UsageLedger_conversationId_createdAt_idx"
  ON "UsageLedger"("conversationId", "createdAt");

CREATE TABLE IF NOT EXISTS "UserMonthlyUsage" (
  "id" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  "userId" TEXT NOT NULL,
  "monthBucket" TIMESTAMP(3) NOT NULL,
  "inputTokens" INTEGER NOT NULL DEFAULT 0,
  "outputTokens" INTEGER NOT NULL DEFAULT 0,
  "totalTokens" INTEGER NOT NULL DEFAULT 0,
  "estimatedCostUsd" DECIMAL(12,6) NOT NULL DEFAULT 0,
  "proactiveRuns" INTEGER NOT NULL DEFAULT 0,
  "runtimeTurns" INTEGER NOT NULL DEFAULT 0,
  CONSTRAINT "UserMonthlyUsage_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "UserMonthlyUsage_userId_monthBucket_key"
  ON "UserMonthlyUsage"("userId", "monthBucket");
CREATE INDEX IF NOT EXISTS "UserMonthlyUsage_userId_monthBucket_estimatedCostUsd_idx"
  ON "UserMonthlyUsage"("userId", "monthBucket", "estimatedCostUsd");

CREATE TABLE IF NOT EXISTS "UserLimit" (
  "id" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  "userId" TEXT NOT NULL,
  "planCode" TEXT NOT NULL DEFAULT 'starter_10_usd',
  "monthlyCostSoftUsd" DECIMAL(12,6) NOT NULL DEFAULT 2.8,
  "monthlyCostHardUsd" DECIMAL(12,6) NOT NULL DEFAULT 3.25,
  "monthlyInputTokenLimit" INTEGER,
  "monthlyOutputTokenLimit" INTEGER,
  "monthlyTotalTokenLimit" INTEGER,
  "monthlyProactiveRunLimit" INTEGER NOT NULL DEFAULT 600,
  "monthlyRuntimeTurnLimit" INTEGER NOT NULL DEFAULT 3000,
  "enforcementMode" TEXT NOT NULL DEFAULT 'enforce_hard_cap',
  CONSTRAINT "UserLimit_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "UserLimit_userId_key" ON "UserLimit"("userId");
CREATE INDEX IF NOT EXISTS "UserLimit_planCode_idx" ON "UserLimit"("planCode");

CREATE TABLE IF NOT EXISTS "DataRetentionPolicy" (
  "id" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  "key" TEXT NOT NULL,
  "retentionDays" INTEGER NOT NULL,
  "hardDelete" BOOLEAN NOT NULL DEFAULT false,
  "enabled" BOOLEAN NOT NULL DEFAULT true,
  "scope" TEXT NOT NULL DEFAULT 'global',
  "description" TEXT,
  "metadata" JSONB,
  CONSTRAINT "DataRetentionPolicy_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "DataRetentionPolicy_key_key"
  ON "DataRetentionPolicy"("key");

-- -----------------------------------------------------------------------------
-- Foreign keys
-- -----------------------------------------------------------------------------

ALTER TABLE "UserChannelIdentity"
  ADD CONSTRAINT "UserChannelIdentity_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "UnifiedConversation"
  ADD CONSTRAINT "UnifiedConversation_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "UnifiedConversationLink"
  ADD CONSTRAINT "UnifiedConversationLink_unifiedConversationId_fkey"
  FOREIGN KEY ("unifiedConversationId") REFERENCES "UnifiedConversation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "UnifiedConversationLink"
  ADD CONSTRAINT "UnifiedConversationLink_conversationId_fkey"
  FOREIGN KEY ("conversationId") REFERENCES "Conversation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "UserPreference"
  ADD CONSTRAINT "UserPreference_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "UserDirective"
  ADD CONSTRAINT "UserDirective_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "UserDirective"
  ADD CONSTRAINT "UserDirective_sourceConversationId_fkey"
  FOREIGN KEY ("sourceConversationId") REFERENCES "Conversation"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "UserDirective"
  ADD CONSTRAINT "UserDirective_sourceMessageId_fkey"
  FOREIGN KEY ("sourceMessageId") REFERENCES "ConversationMessage"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "UserDirective"
  ADD CONSTRAINT "UserDirective_compiledRuleId_fkey"
  FOREIGN KEY ("compiledRuleId") REFERENCES "CanonicalRule"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "UserActionPolicy"
  ADD CONSTRAINT "UserActionPolicy_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "UsageLedger"
  ADD CONSTRAINT "UsageLedger_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "UserMonthlyUsage"
  ADD CONSTRAINT "UserMonthlyUsage_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "UserLimit"
  ADD CONSTRAINT "UserLimit_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- -----------------------------------------------------------------------------
-- Seed defaults and backfill
-- -----------------------------------------------------------------------------

INSERT INTO "DataRetentionPolicy" (
  "id", "createdAt", "updatedAt", "key", "retentionDays", "hardDelete", "enabled", "scope", "description", "metadata"
)
VALUES
  (
    concat('drp_', substr(md5('conversation_message_operational'), 1, 24)),
    CURRENT_TIMESTAMP,
    CURRENT_TIMESTAMP,
    'conversation_message_operational',
    90,
    true,
    true,
    'global',
    'Operational conversation messages retention with active tail protection',
    '{"protected_tail_messages":120}'::jsonb
  ),
  (
    concat('drp_', substr(md5('approval_operational'), 1, 24)),
    CURRENT_TIMESTAMP,
    CURRENT_TIMESTAMP,
    'approval_operational',
    90,
    true,
    true,
    'global',
    'Terminal approval records retention',
    NULL
  ),
  (
    concat('drp_', substr(md5('policy_logs_operational'), 1, 24)),
    CURRENT_TIMESTAMP,
    CURRENT_TIMESTAMP,
    'policy_logs_operational',
    90,
    true,
    true,
    'global',
    'Policy decision/execution logs retention',
    NULL
  ),
  (
    concat('drp_', substr(md5('pending_turn_state'), 1, 24)),
    CURRENT_TIMESTAMP,
    CURRENT_TIMESTAMP,
    'pending_turn_state',
    90,
    true,
    true,
    'global',
    'Pending turn state retention after expiry',
    NULL
  )
ON CONFLICT ("key") DO UPDATE SET
  "retentionDays" = EXCLUDED."retentionDays",
  "hardDelete" = EXCLUDED."hardDelete",
  "enabled" = EXCLUDED."enabled",
  "scope" = EXCLUDED."scope",
  "description" = EXCLUDED."description",
  "metadata" = EXCLUDED."metadata",
  "updatedAt" = CURRENT_TIMESTAMP;

INSERT INTO "UserLimit" (
  "id",
  "createdAt",
  "updatedAt",
  "userId",
  "planCode",
  "monthlyCostSoftUsd",
  "monthlyCostHardUsd",
  "monthlyProactiveRunLimit",
  "monthlyRuntimeTurnLimit",
  "enforcementMode"
)
SELECT
  concat('ul_', substr(md5(u."id" || ':starter_limit'), 1, 24)),
  CURRENT_TIMESTAMP,
  CURRENT_TIMESTAMP,
  u."id",
  'starter_10_usd',
  2.80,
  3.25,
  600,
  3000,
  'enforce_hard_cap'
FROM "User" u
LEFT JOIN "UserLimit" ul ON ul."userId" = u."id"
WHERE ul."id" IS NULL;

INSERT INTO "UserActionPolicy" (
  "id",
  "createdAt",
  "updatedAt",
  "userId",
  "actionType",
  "requiresApproval",
  "policySource"
)
SELECT
  concat('uap_', substr(md5(u."id" || ':send_email'), 1, 24)),
  CURRENT_TIMESTAMP,
  CURRENT_TIMESTAMP,
  u."id",
  'send_email',
  true,
  'system_default'
FROM "User" u
LEFT JOIN "UserActionPolicy" uap
  ON uap."userId" = u."id" AND uap."actionType" = 'send_email'
WHERE uap."id" IS NULL;

INSERT INTO "UnifiedConversation" (
  "id",
  "createdAt",
  "updatedAt",
  "userId",
  "status",
  "retentionMode"
)
SELECT
  concat('uc_', substr(md5(u."id" || ':primary'), 1, 24)),
  CURRENT_TIMESTAMP,
  CURRENT_TIMESTAMP,
  u."id",
  'active',
  'keep_active_tail'
FROM "User" u
LEFT JOIN "UnifiedConversation" uc
  ON uc."userId" = u."id" AND uc."status" = 'active'
WHERE uc."id" IS NULL;

INSERT INTO "UnifiedConversationLink" (
  "id",
  "createdAt",
  "updatedAt",
  "unifiedConversationId",
  "conversationId",
  "provider",
  "channelId",
  "threadId"
)
SELECT
  concat('ucl_', substr(md5(c."id"), 1, 24)),
  CURRENT_TIMESTAMP,
  CURRENT_TIMESTAMP,
  (
    SELECT uc."id"
    FROM "UnifiedConversation" uc
    WHERE uc."userId" = c."userId"
      AND uc."status" = 'active'
    ORDER BY uc."createdAt" ASC
    LIMIT 1
  ) AS "unifiedConversationId",
  c."id",
  c."provider",
  c."channelId",
  c."threadId"
FROM "Conversation" c
LEFT JOIN "UnifiedConversationLink" ucl ON ucl."conversationId" = c."id"
WHERE ucl."id" IS NULL;

-- -----------------------------------------------------------------------------
-- RLS helpers and baseline policies
-- -----------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION app_is_service_role() RETURNS boolean
LANGUAGE SQL
STABLE
AS $$
  SELECT
    current_user IN ('postgres', 'service_role', 'supabase_admin')
    OR COALESCE(NULLIF(current_setting('app.bypass_rls', true), ''), 'false') = 'true';
$$;

CREATE OR REPLACE FUNCTION app_user_matches(target_user_id text) RETURNS boolean
LANGUAGE SQL
STABLE
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM "User" u
    WHERE u."id" = target_user_id
      AND (
        u."id" = NULLIF(current_setting('app.current_user_id', true), '')
        OR u."workosSubject" = NULLIF(current_setting('request.jwt.claim.sub', true), '')
      )
  );
$$;

ALTER TABLE "UserChannelIdentity" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "UnifiedConversation" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "UnifiedConversationLink" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "UserPreference" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "UserDirective" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "UserActionPolicy" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "UsageLedger" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "UserMonthlyUsage" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "UserLimit" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "DataRetentionPolicy" ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "UserChannelIdentity_service_all" ON "UserChannelIdentity";
CREATE POLICY "UserChannelIdentity_service_all" ON "UserChannelIdentity"
  FOR ALL
  USING (app_is_service_role())
  WITH CHECK (app_is_service_role());

DROP POLICY IF EXISTS "UserChannelIdentity_owner_select" ON "UserChannelIdentity";
CREATE POLICY "UserChannelIdentity_owner_select" ON "UserChannelIdentity"
  FOR SELECT
  USING (app_user_matches("userId"));

DROP POLICY IF EXISTS "UserChannelIdentity_owner_insert" ON "UserChannelIdentity";
CREATE POLICY "UserChannelIdentity_owner_insert" ON "UserChannelIdentity"
  FOR INSERT
  WITH CHECK (app_user_matches("userId"));

DROP POLICY IF EXISTS "UserChannelIdentity_owner_update" ON "UserChannelIdentity";
CREATE POLICY "UserChannelIdentity_owner_update" ON "UserChannelIdentity"
  FOR UPDATE
  USING (app_user_matches("userId"))
  WITH CHECK (app_user_matches("userId"));

DROP POLICY IF EXISTS "UserChannelIdentity_owner_delete" ON "UserChannelIdentity";
CREATE POLICY "UserChannelIdentity_owner_delete" ON "UserChannelIdentity"
  FOR DELETE
  USING (app_user_matches("userId"));

DROP POLICY IF EXISTS "UnifiedConversation_service_all" ON "UnifiedConversation";
CREATE POLICY "UnifiedConversation_service_all" ON "UnifiedConversation"
  FOR ALL
  USING (app_is_service_role())
  WITH CHECK (app_is_service_role());

DROP POLICY IF EXISTS "UnifiedConversation_owner_select" ON "UnifiedConversation";
CREATE POLICY "UnifiedConversation_owner_select" ON "UnifiedConversation"
  FOR SELECT
  USING (app_user_matches("userId"));

DROP POLICY IF EXISTS "UnifiedConversation_owner_insert" ON "UnifiedConversation";
CREATE POLICY "UnifiedConversation_owner_insert" ON "UnifiedConversation"
  FOR INSERT
  WITH CHECK (app_user_matches("userId"));

DROP POLICY IF EXISTS "UnifiedConversation_owner_update" ON "UnifiedConversation";
CREATE POLICY "UnifiedConversation_owner_update" ON "UnifiedConversation"
  FOR UPDATE
  USING (app_user_matches("userId"))
  WITH CHECK (app_user_matches("userId"));

DROP POLICY IF EXISTS "UnifiedConversationLink_service_all" ON "UnifiedConversationLink";
CREATE POLICY "UnifiedConversationLink_service_all" ON "UnifiedConversationLink"
  FOR ALL
  USING (app_is_service_role())
  WITH CHECK (app_is_service_role());

DROP POLICY IF EXISTS "UnifiedConversationLink_owner_select" ON "UnifiedConversationLink";
CREATE POLICY "UnifiedConversationLink_owner_select" ON "UnifiedConversationLink"
  FOR SELECT
  USING (
    EXISTS (
      SELECT 1
      FROM "UnifiedConversation" uc
      WHERE uc."id" = "UnifiedConversationLink"."unifiedConversationId"
        AND app_user_matches(uc."userId")
    )
  );

DROP POLICY IF EXISTS "UserPreference_service_all" ON "UserPreference";
CREATE POLICY "UserPreference_service_all" ON "UserPreference"
  FOR ALL
  USING (app_is_service_role())
  WITH CHECK (app_is_service_role());

DROP POLICY IF EXISTS "UserPreference_owner_select" ON "UserPreference";
CREATE POLICY "UserPreference_owner_select" ON "UserPreference"
  FOR SELECT
  USING (app_user_matches("userId"));

DROP POLICY IF EXISTS "UserPreference_owner_insert" ON "UserPreference";
CREATE POLICY "UserPreference_owner_insert" ON "UserPreference"
  FOR INSERT
  WITH CHECK (app_user_matches("userId"));

DROP POLICY IF EXISTS "UserPreference_owner_update" ON "UserPreference";
CREATE POLICY "UserPreference_owner_update" ON "UserPreference"
  FOR UPDATE
  USING (app_user_matches("userId"))
  WITH CHECK (app_user_matches("userId"));

DROP POLICY IF EXISTS "UserDirective_service_all" ON "UserDirective";
CREATE POLICY "UserDirective_service_all" ON "UserDirective"
  FOR ALL
  USING (app_is_service_role())
  WITH CHECK (app_is_service_role());

DROP POLICY IF EXISTS "UserDirective_owner_select" ON "UserDirective";
CREATE POLICY "UserDirective_owner_select" ON "UserDirective"
  FOR SELECT
  USING (app_user_matches("userId"));

DROP POLICY IF EXISTS "UserDirective_owner_insert" ON "UserDirective";
CREATE POLICY "UserDirective_owner_insert" ON "UserDirective"
  FOR INSERT
  WITH CHECK (app_user_matches("userId"));

DROP POLICY IF EXISTS "UserDirective_owner_update" ON "UserDirective";
CREATE POLICY "UserDirective_owner_update" ON "UserDirective"
  FOR UPDATE
  USING (app_user_matches("userId"))
  WITH CHECK (app_user_matches("userId"));

DROP POLICY IF EXISTS "UserActionPolicy_service_all" ON "UserActionPolicy";
CREATE POLICY "UserActionPolicy_service_all" ON "UserActionPolicy"
  FOR ALL
  USING (app_is_service_role())
  WITH CHECK (app_is_service_role());

DROP POLICY IF EXISTS "UserActionPolicy_owner_select" ON "UserActionPolicy";
CREATE POLICY "UserActionPolicy_owner_select" ON "UserActionPolicy"
  FOR SELECT
  USING (app_user_matches("userId"));

DROP POLICY IF EXISTS "UserActionPolicy_owner_insert" ON "UserActionPolicy";
CREATE POLICY "UserActionPolicy_owner_insert" ON "UserActionPolicy"
  FOR INSERT
  WITH CHECK (app_user_matches("userId"));

DROP POLICY IF EXISTS "UserActionPolicy_owner_update" ON "UserActionPolicy";
CREATE POLICY "UserActionPolicy_owner_update" ON "UserActionPolicy"
  FOR UPDATE
  USING (app_user_matches("userId"))
  WITH CHECK (app_user_matches("userId"));

DROP POLICY IF EXISTS "UsageLedger_service_all" ON "UsageLedger";
CREATE POLICY "UsageLedger_service_all" ON "UsageLedger"
  FOR ALL
  USING (app_is_service_role())
  WITH CHECK (app_is_service_role());

DROP POLICY IF EXISTS "UsageLedger_owner_select" ON "UsageLedger";
CREATE POLICY "UsageLedger_owner_select" ON "UsageLedger"
  FOR SELECT
  USING (app_user_matches("userId"));

DROP POLICY IF EXISTS "UserMonthlyUsage_service_all" ON "UserMonthlyUsage";
CREATE POLICY "UserMonthlyUsage_service_all" ON "UserMonthlyUsage"
  FOR ALL
  USING (app_is_service_role())
  WITH CHECK (app_is_service_role());

DROP POLICY IF EXISTS "UserMonthlyUsage_owner_select" ON "UserMonthlyUsage";
CREATE POLICY "UserMonthlyUsage_owner_select" ON "UserMonthlyUsage"
  FOR SELECT
  USING (app_user_matches("userId"));

DROP POLICY IF EXISTS "UserLimit_service_all" ON "UserLimit";
CREATE POLICY "UserLimit_service_all" ON "UserLimit"
  FOR ALL
  USING (app_is_service_role())
  WITH CHECK (app_is_service_role());

DROP POLICY IF EXISTS "UserLimit_owner_select" ON "UserLimit";
CREATE POLICY "UserLimit_owner_select" ON "UserLimit"
  FOR SELECT
  USING (app_user_matches("userId"));

DROP POLICY IF EXISTS "DataRetentionPolicy_service_all" ON "DataRetentionPolicy";
CREATE POLICY "DataRetentionPolicy_service_all" ON "DataRetentionPolicy"
  FOR ALL
  USING (app_is_service_role())
  WITH CHECK (app_is_service_role());
