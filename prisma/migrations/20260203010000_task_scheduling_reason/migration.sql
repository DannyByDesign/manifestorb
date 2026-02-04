-- Create TaskSchedulingReason table for scheduling explanations with TTL
CREATE TABLE "TaskSchedulingReason" (
    "id" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "reason" JSONB NOT NULL,
    "taskId" TEXT NOT NULL,

    CONSTRAINT "TaskSchedulingReason_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "TaskSchedulingReason_taskId_key" ON "TaskSchedulingReason"("taskId");
CREATE INDEX "TaskSchedulingReason_expiresAt_idx" ON "TaskSchedulingReason"("expiresAt");

ALTER TABLE "TaskSchedulingReason"
ADD CONSTRAINT "TaskSchedulingReason_taskId_fkey"
FOREIGN KEY ("taskId") REFERENCES "Task"("id") ON DELETE CASCADE ON UPDATE CASCADE;
