-- Final legacy Rule migration: backfill canonical rows + version history,
-- re-anchor Action rows by emailAccountId, then drop legacy Rule surfaces.

ALTER TABLE "Action"
  ADD COLUMN "emailAccountId" TEXT;

WITH legacy_rule_source AS (
  SELECT
    r."id" AS legacy_rule_id,
    r."createdAt",
    r."updatedAt",
    r."name",
    r."enabled" AS legacy_enabled,
    r."expiresAt",
    r."instructions",
    r."groupId",
    r."from",
    r."to",
    r."subject",
    r."body",
    r."conditionalOperator",
    r."promptText",
    r."runOnThreads",
    ea."userId",
    r."emailAccountId",
    COALESCE(action_rows.action_count, 0) AS action_count,
    COALESCE(action_rows.action_plan, jsonb_build_object('actions', '[]'::jsonb)) AS action_plan,
    COALESCE(condition_rows.conditions, '[]'::jsonb) AS conditions,
    COALESCE(category_rows.category_count, 0) AS category_count
  FROM "Rule" r
  JOIN "EmailAccount" ea
    ON ea."id" = r."emailAccountId"
  LEFT JOIN LATERAL (
    SELECT
      COUNT(*)::int AS action_count,
      jsonb_build_object(
        'actions',
        COALESCE(
          jsonb_agg(
            jsonb_build_object(
              'actionType', a."type"::text,
              'args',
              jsonb_strip_nulls(
                jsonb_build_object(
                  'legacyActionId', a."id",
                  'label', a."label",
                  'labelId', a."labelId",
                  'subject', a."subject",
                  'content', a."content",
                  'to', a."to",
                  'cc', a."cc",
                  'bcc', a."bcc",
                  'url', a."url",
                  'folderName', a."folderName",
                  'folderId', a."folderId",
                  'delayInMinutes', a."delayInMinutes",
                  'payload', a."payload"
                )
              )
            )
            ORDER BY a."createdAt" ASC, a."id" ASC
          ),
          '[]'::jsonb
        )
      ) AS action_plan
    FROM "Action" a
    WHERE a."ruleId" = r."id"
  ) AS action_rows ON TRUE
  LEFT JOIN LATERAL (
    SELECT COALESCE(jsonb_agg(condition_entry), '[]'::jsonb) AS conditions
    FROM (
      VALUES
        (
          CASE
            WHEN r."from" IS NOT NULL AND btrim(r."from") <> ''
            THEN jsonb_build_object(
              'field', 'email.sender',
              'op', 'contains',
              'value', r."from"
            )
            ELSE NULL
          END
        ),
        (
          CASE
            WHEN r."to" IS NOT NULL AND btrim(r."to") <> ''
            THEN jsonb_build_object(
              'field', 'email.recipient',
              'op', 'contains',
              'value', r."to"
            )
            ELSE NULL
          END
        ),
        (
          CASE
            WHEN r."subject" IS NOT NULL AND btrim(r."subject") <> ''
            THEN jsonb_build_object(
              'field', 'email.subject',
              'op', 'contains',
              'value', r."subject"
            )
            ELSE NULL
          END
        ),
        (
          CASE
            WHEN r."body" IS NOT NULL AND btrim(r."body") <> ''
            THEN jsonb_build_object(
              'field', 'email.body',
              'op', 'contains',
              'value', r."body"
            )
            ELSE NULL
          END
        )
    ) AS entries(condition_entry)
    WHERE condition_entry IS NOT NULL
  ) AS condition_rows ON TRUE
  LEFT JOIN LATERAL (
    SELECT COUNT(*)::int AS category_count
    FROM "_CategoryToRule" ctr
    WHERE ctr."B" = r."id"
  ) AS category_rows ON TRUE
),
prepared_migration_rules AS (
  SELECT
    concat('legacy_rule_', src.legacy_rule_id) AS canonical_rule_id,
    src.*,
    (
      SELECT COALESCE(jsonb_agg(warning_entry), '[]'::jsonb)
      FROM (
        VALUES
          (
            CASE
              WHEN src."instructions" IS NOT NULL AND btrim(src."instructions") <> ''
              THEN 'AI instruction conditions were not auto-translated; manual review required.'
              ELSE NULL
            END
          ),
          (
            CASE
              WHEN src."groupId" IS NOT NULL
              THEN 'Group-based matching was not auto-translated; manual review required.'
              ELSE NULL
            END
          ),
          (
            CASE
              WHEN src.category_count > 0
              THEN 'Category filters were not auto-translated; manual review required.'
              ELSE NULL
            END
          ),
          (
            CASE
              WHEN src."conditionalOperator" = 'OR'
              THEN 'Legacy OR conditions require manual migration.'
              ELSE NULL
            END
          ),
          (
            CASE
              WHEN src.action_count = 0
              THEN 'Legacy rule had no actions and was migrated in disabled review mode.'
              ELSE NULL
            END
          )
      ) AS warnings(warning_entry)
      WHERE warning_entry IS NOT NULL
    ) AS compiler_warnings,
    (
      (src."instructions" IS NOT NULL AND btrim(src."instructions") <> '')
      OR src."groupId" IS NOT NULL
      OR src.category_count > 0
      OR src."conditionalOperator" = 'OR'
    ) AS needs_manual_review
  FROM legacy_rule_source src
),
inserted_rules AS (
  INSERT INTO "CanonicalRule" (
    "id",
    "createdAt",
    "updatedAt",
    "version",
    "type",
    "enabled",
    "priority",
    "name",
    "description",
    "scope",
    "match",
    "trigger",
    "actionPlan",
    "expiresAt",
    "sourceMode",
    "sourceNl",
    "compilerVersion",
    "compilerWarnings",
    "legacyRefType",
    "legacyRefId",
    "userId",
    "emailAccountId"
  )
  SELECT
    pmr.canonical_rule_id,
    pmr."createdAt",
    pmr."updatedAt",
    1 AS "version",
    'automation' AS "type",
    CASE
      WHEN pmr.legacy_enabled = false THEN false
      WHEN pmr.action_count = 0 THEN false
      WHEN pmr.needs_manual_review THEN false
      ELSE true
    END AS "enabled",
    0 AS "priority",
    pmr."name",
    COALESCE(
      NULLIF(btrim(pmr."instructions"), ''),
      NULLIF(btrim(pmr."promptText"), ''),
      'Migrated from legacy Rule table.'
    ) AS "description",
    jsonb_build_object(
      'surfaces', '[]'::jsonb,
      'resources', jsonb_build_array('email')
    ) AS "scope",
    jsonb_build_object(
      'resource', 'email',
      'operation', CASE
        WHEN pmr."runOnThreads" THEN 'legacy_rule_thread'
        ELSE 'legacy_rule_message'
      END,
      'conditions', pmr.conditions
    ) AS "match",
    jsonb_build_object(
      'kind', 'event',
      'eventType', 'email.received'
    ) AS "trigger",
    pmr.action_plan AS "actionPlan",
    pmr."expiresAt",
    'migration' AS "sourceMode",
    COALESCE(
      NULLIF(btrim(pmr."promptText"), ''),
      NULLIF(btrim(pmr."instructions"), '')
    ) AS "sourceNl",
    'legacy-rule-backfill-v1' AS "compilerVersion",
    CASE
      WHEN jsonb_array_length(pmr.compiler_warnings) > 0
      THEN pmr.compiler_warnings
      ELSE NULL
    END AS "compilerWarnings",
    'Rule' AS "legacyRefType",
    pmr.legacy_rule_id AS "legacyRefId",
    pmr."userId",
    pmr."emailAccountId"
  FROM prepared_migration_rules pmr
  WHERE NOT EXISTS (
    SELECT 1
    FROM "CanonicalRule" cr
    WHERE cr."legacyRefType" = 'Rule'
      AND cr."legacyRefId" = pmr.legacy_rule_id
  )
  RETURNING *
)
INSERT INTO "CanonicalRuleVersion" (
  "id",
  "createdAt",
  "canonicalRuleId",
  "version",
  "payload",
  "sourceMode"
)
SELECT
  concat('legacy_rule_version_', inserted."id") AS "id",
  inserted."createdAt",
  inserted."id" AS "canonicalRuleId",
  inserted."version",
  jsonb_strip_nulls(
    jsonb_build_object(
      'id', inserted."id",
      'version', inserted."version",
      'type', inserted."type",
      'enabled', inserted."enabled",
      'priority', inserted."priority",
      'name', inserted."name",
      'description', inserted."description",
      'scope', inserted."scope",
      'trigger', inserted."trigger",
      'match', inserted."match",
      'actionPlan', inserted."actionPlan",
      'source',
      jsonb_strip_nulls(
        jsonb_build_object(
          'mode', inserted."sourceMode",
          'sourceNl', inserted."sourceNl",
          'compilerVersion', inserted."compilerVersion",
          'compilerWarnings', inserted."compilerWarnings"
        )
      ),
      'expiresAt', CASE
        WHEN inserted."expiresAt" IS NULL THEN NULL
        ELSE to_jsonb(inserted."expiresAt")
      END,
      'disabledUntil', CASE
        WHEN inserted."disabledUntil" IS NULL THEN NULL
        ELSE to_jsonb(inserted."disabledUntil")
      END,
      'legacyRefType', inserted."legacyRefType",
      'legacyRefId', inserted."legacyRefId"
    )
  ) AS "payload",
  inserted."sourceMode"
FROM inserted_rules inserted;

UPDATE "Action" a
SET "emailAccountId" = r."emailAccountId"
FROM "Rule" r
WHERE a."ruleId" = r."id"
  AND a."emailAccountId" IS NULL;

ALTER TABLE "Action"
  ALTER COLUMN "emailAccountId" SET NOT NULL;

CREATE INDEX "Action_emailAccountId_idx"
  ON "Action"("emailAccountId");

ALTER TABLE "Action"
  ADD CONSTRAINT "Action_emailAccountId_fkey"
  FOREIGN KEY ("emailAccountId") REFERENCES "EmailAccount"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

DROP TABLE IF EXISTS "_CategoryToRule";
DROP TABLE "Rule" CASCADE;
