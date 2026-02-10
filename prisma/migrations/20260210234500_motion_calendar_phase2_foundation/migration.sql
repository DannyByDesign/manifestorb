-- Motion calendar phase 2 foundation:
-- - canonical calendar event shadow
-- - event-level policy model
-- - planner run audit model
-- - task preference week-start day

CREATE TYPE "WeekStartDay" AS ENUM ('SUNDAY', 'MONDAY');

ALTER TABLE "TaskPreference"
ADD COLUMN "weekStartDay" "WeekStartDay" NOT NULL DEFAULT 'SUNDAY';

CREATE TABLE "CalendarEventShadow" (
  "id" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  "userId" TEXT NOT NULL,
  "emailAccountId" TEXT NOT NULL,
  "provider" TEXT NOT NULL,
  "calendarId" TEXT NOT NULL,
  "externalEventId" TEXT NOT NULL,
  "iCalUid" TEXT,
  "seriesMasterId" TEXT,
  "versionToken" TEXT,
  "status" TEXT,
  "title" TEXT,
  "description" TEXT,
  "location" TEXT,
  "organizerEmail" TEXT,
  "attendees" JSONB,
  "allDay" BOOLEAN NOT NULL DEFAULT false,
  "startTime" TIMESTAMP(3),
  "endTime" TIMESTAMP(3),
  "canEdit" BOOLEAN NOT NULL DEFAULT true,
  "canRespond" BOOLEAN NOT NULL DEFAULT true,
  "busyStatus" TEXT,
  "isDeleted" BOOLEAN NOT NULL DEFAULT false,
  "lastSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "lastSyncedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "lastMutationSource" TEXT,
  "metadata" JSONB,

  CONSTRAINT "CalendarEventShadow_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "CalendarEventPolicy" (
  "id" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  "userId" TEXT NOT NULL,
  "emailAccountId" TEXT NOT NULL,
  "shadowEventId" TEXT,
  "title" TEXT,
  "source" TEXT NOT NULL DEFAULT 'default',
  "priority" INTEGER NOT NULL DEFAULT 0,
  "reschedulePolicy" "TaskReschedulePolicy" NOT NULL DEFAULT 'FLEXIBLE',
  "notifyOnAutoMove" BOOLEAN NOT NULL DEFAULT true,
  "isProtected" BOOLEAN NOT NULL DEFAULT false,
  "disabledUntil" TIMESTAMP(3),
  "expiresAt" TIMESTAMP(3),
  "criteria" JSONB,

  CONSTRAINT "CalendarEventPolicy_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "CalendarPlanRun" (
  "id" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  "userId" TEXT NOT NULL,
  "emailAccountId" TEXT NOT NULL,
  "source" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'STARTED',
  "trigger" JSONB,
  "input" JSONB,
  "decisions" JSONB,
  "result" JSONB,
  "error" TEXT,
  "correlationId" TEXT,
  "durationMs" INTEGER,

  CONSTRAINT "CalendarPlanRun_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "CalendarEventShadow_emailAccountId_provider_calendarId_externalEventId_key"
ON "CalendarEventShadow"("emailAccountId", "provider", "calendarId", "externalEventId");

CREATE INDEX "CalendarEventShadow_userId_provider_iCalUid_idx"
ON "CalendarEventShadow"("userId", "provider", "iCalUid");

CREATE INDEX "CalendarEventShadow_emailAccountId_provider_calendarId_idx"
ON "CalendarEventShadow"("emailAccountId", "provider", "calendarId");

CREATE INDEX "CalendarEventShadow_userId_updatedAt_idx"
ON "CalendarEventShadow"("userId", "updatedAt");

CREATE INDEX "CalendarEventPolicy_userId_emailAccountId_priority_idx"
ON "CalendarEventPolicy"("userId", "emailAccountId", "priority");

CREATE INDEX "CalendarEventPolicy_userId_reschedulePolicy_idx"
ON "CalendarEventPolicy"("userId", "reschedulePolicy");

CREATE INDEX "CalendarEventPolicy_shadowEventId_idx"
ON "CalendarEventPolicy"("shadowEventId");

CREATE INDEX "CalendarPlanRun_userId_createdAt_idx"
ON "CalendarPlanRun"("userId", "createdAt");

CREATE INDEX "CalendarPlanRun_emailAccountId_createdAt_idx"
ON "CalendarPlanRun"("emailAccountId", "createdAt");

CREATE INDEX "CalendarPlanRun_source_createdAt_idx"
ON "CalendarPlanRun"("source", "createdAt");

CREATE INDEX "CalendarPlanRun_status_createdAt_idx"
ON "CalendarPlanRun"("status", "createdAt");

ALTER TABLE "CalendarEventShadow"
ADD CONSTRAINT "CalendarEventShadow_userId_fkey"
FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "CalendarEventShadow"
ADD CONSTRAINT "CalendarEventShadow_emailAccountId_fkey"
FOREIGN KEY ("emailAccountId") REFERENCES "EmailAccount"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "CalendarEventPolicy"
ADD CONSTRAINT "CalendarEventPolicy_userId_fkey"
FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "CalendarEventPolicy"
ADD CONSTRAINT "CalendarEventPolicy_emailAccountId_fkey"
FOREIGN KEY ("emailAccountId") REFERENCES "EmailAccount"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "CalendarEventPolicy"
ADD CONSTRAINT "CalendarEventPolicy_shadowEventId_fkey"
FOREIGN KEY ("shadowEventId") REFERENCES "CalendarEventShadow"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "CalendarPlanRun"
ADD CONSTRAINT "CalendarPlanRun_userId_fkey"
FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "CalendarPlanRun"
ADD CONSTRAINT "CalendarPlanRun_emailAccountId_fkey"
FOREIGN KEY ("emailAccountId") REFERENCES "EmailAccount"("id") ON DELETE CASCADE ON UPDATE CASCADE;
