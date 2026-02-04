-- Add TaskReschedulePolicy enum and column

CREATE TYPE "TaskReschedulePolicy" AS ENUM ('FIXED', 'FLEXIBLE', 'APPROVAL_REQUIRED');

ALTER TABLE "Task"
ADD COLUMN "reschedulePolicy" "TaskReschedulePolicy" NOT NULL DEFAULT 'FLEXIBLE';
