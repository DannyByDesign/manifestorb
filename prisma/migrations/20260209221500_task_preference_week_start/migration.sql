ALTER TABLE "TaskPreference"
ADD COLUMN "weekStartDay" TEXT NOT NULL DEFAULT 'sunday';

ALTER TABLE "TaskPreference"
ADD CONSTRAINT "TaskPreference_weekStartDay_check"
CHECK ("weekStartDay" IN ('sunday', 'monday'));
