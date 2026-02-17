#!/usr/bin/env sh
set -eu

SCHEMA_PATH="prisma/schema.prisma"

echo "[deploy] prisma migrate deploy starting"
# Fail fast instead of hanging indefinitely during Railway predeploy.
if command -v timeout >/dev/null 2>&1; then
  timeout 180 bunx prisma migrate deploy --schema "$SCHEMA_PATH"
else
  bunx prisma migrate deploy --schema "$SCHEMA_PATH"
fi

echo "[deploy] repairing known schema drift (Knowledge.userId) if needed"
bunx prisma db execute --config prisma.config.ts --stdin <<'SQL'
ALTER TABLE "Knowledge"
ADD COLUMN IF NOT EXISTS "userId" TEXT;

UPDATE "Knowledge" k
SET "userId" = ea."userId"
FROM "EmailAccount" ea
WHERE k."userId" IS NULL
  AND k."emailAccountId" IS NOT NULL
  AND ea.id = k."emailAccountId";
SQL

echo "[deploy] verifying required database columns"
bunx prisma db execute --config prisma.config.ts --stdin <<'SQL'
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'TaskPreference'
      AND column_name = 'selectedCalendarIds'
  ) THEN
    RAISE EXCEPTION 'missing required column: TaskPreference.selectedCalendarIds';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'TaskPreference'
      AND column_name = 'defaultMeetingDurationMin'
  ) THEN
    RAISE EXCEPTION 'missing required column: TaskPreference.defaultMeetingDurationMin';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'TaskPreference'
      AND column_name = 'meetingSlotCount'
  ) THEN
    RAISE EXCEPTION 'missing required column: TaskPreference.meetingSlotCount';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'TaskPreference'
      AND column_name = 'meetingExpirySeconds'
  ) THEN
    RAISE EXCEPTION 'missing required column: TaskPreference.meetingExpirySeconds';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'TaskSchedule'
      AND column_name = 'calendarEventId'
  ) THEN
    RAISE EXCEPTION 'missing required column: TaskSchedule.calendarEventId';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'Knowledge'
      AND column_name = 'id'
  ) THEN
    RAISE EXCEPTION 'missing required column: Knowledge.id';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'Knowledge'
      AND column_name = 'title'
  ) THEN
    RAISE EXCEPTION 'missing required column: Knowledge.title';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'Knowledge'
      AND column_name = 'content'
  ) THEN
    RAISE EXCEPTION 'missing required column: Knowledge.content';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'Knowledge'
      AND column_name = 'userId'
  ) THEN
    RAISE EXCEPTION 'missing required column: Knowledge.userId';
  END IF;

END
$$;
SQL

echo "[deploy] prisma migrate deploy finished"
