-- Ensure TaskPreference contains meeting defaults used by runtime/tooling.
ALTER TABLE "TaskPreference"
ADD COLUMN IF NOT EXISTS "defaultMeetingDurationMin" INTEGER NOT NULL DEFAULT 30;

ALTER TABLE "TaskPreference"
ADD COLUMN IF NOT EXISTS "meetingSlotCount" INTEGER NOT NULL DEFAULT 3;

ALTER TABLE "TaskPreference"
ADD COLUMN IF NOT EXISTS "meetingExpirySeconds" INTEGER NOT NULL DEFAULT 86400;

-- Persist task<->calendar-event linkage for task rescheduling workflows.
ALTER TABLE "TaskSchedule"
ADD COLUMN IF NOT EXISTS "calendarEventId" TEXT;

CREATE INDEX IF NOT EXISTS "TaskSchedule_calendarEventId_idx"
ON "TaskSchedule"("calendarEventId");
