-- Add task scheduling tables and enums for calendar scheduling

-- Create enums
CREATE TYPE "TaskStatus" AS ENUM ('PENDING', 'IN_PROGRESS', 'COMPLETED', 'CANCELLED');
CREATE TYPE "TaskPriority" AS ENUM ('NONE', 'LOW', 'MEDIUM', 'HIGH');
CREATE TYPE "TaskEnergyLevel" AS ENUM ('LOW', 'MEDIUM', 'HIGH');
CREATE TYPE "TaskTimePreference" AS ENUM ('MORNING', 'AFTERNOON', 'EVENING');

-- Create Task table
CREATE TABLE "Task" (
  "id" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  "title" TEXT NOT NULL,
  "description" TEXT,
  "durationMinutes" INTEGER DEFAULT 30,
  "status" "TaskStatus" NOT NULL DEFAULT 'PENDING',
  "priority" "TaskPriority" DEFAULT 'NONE',
  "energyLevel" "TaskEnergyLevel",
  "preferredTime" "TaskTimePreference",
  "dueDate" TIMESTAMP(3),
  "startDate" TIMESTAMP(3),
  "isAutoScheduled" BOOLEAN NOT NULL DEFAULT false,
  "scheduleLocked" BOOLEAN NOT NULL DEFAULT false,
  "scheduledStart" TIMESTAMP(3),
  "scheduledEnd" TIMESTAMP(3),
  "scheduleScore" DOUBLE PRECISION,
  "lastScheduled" TIMESTAMP(3),
  "userId" TEXT NOT NULL,

  CONSTRAINT "Task_pkey" PRIMARY KEY ("id")
);

-- Create TaskSchedule table
CREATE TABLE "TaskSchedule" (
  "id" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  "scheduledStart" TIMESTAMP(3) NOT NULL,
  "scheduledEnd" TIMESTAMP(3) NOT NULL,
  "calendarId" TEXT,
  "taskId" TEXT NOT NULL,

  CONSTRAINT "TaskSchedule_pkey" PRIMARY KEY ("id")
);

-- Create TaskPreference table
CREATE TABLE "TaskPreference" (
  "id" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  "workHourStart" INTEGER NOT NULL DEFAULT 9,
  "workHourEnd" INTEGER NOT NULL DEFAULT 17,
  "workDays" INTEGER[] DEFAULT ARRAY[1,2,3,4,5]::INTEGER[],
  "bufferMinutes" INTEGER NOT NULL DEFAULT 15,
  "selectedCalendarIds" TEXT[] DEFAULT ARRAY[]::TEXT[],
  "timeZone" TEXT,
  "groupByProject" BOOLEAN NOT NULL DEFAULT false,
  "userId" TEXT NOT NULL,

  CONSTRAINT "TaskPreference_pkey" PRIMARY KEY ("id")
);

-- Create CalendarActionLog table
CREATE TABLE "CalendarActionLog" (
  "id" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "action" TEXT NOT NULL,
  "provider" TEXT NOT NULL,
  "calendarId" TEXT,
  "eventId" TEXT,
  "dryRun" BOOLEAN NOT NULL DEFAULT false,
  "payload" JSONB,
  "response" JSONB,
  "error" JSONB,
  "emailAccountId" TEXT,
  "userId" TEXT NOT NULL,

  CONSTRAINT "CalendarActionLog_pkey" PRIMARY KEY ("id")
);

-- Add indexes
CREATE INDEX "Task_userId_idx" ON "Task"("userId");
CREATE INDEX "Task_status_idx" ON "Task"("status");
CREATE UNIQUE INDEX "TaskSchedule_taskId_key" ON "TaskSchedule"("taskId");
CREATE UNIQUE INDEX "TaskPreference_userId_key" ON "TaskPreference"("userId");
CREATE INDEX "CalendarActionLog_userId_idx" ON "CalendarActionLog"("userId");
CREATE INDEX "CalendarActionLog_provider_action_idx" ON "CalendarActionLog"("provider", "action");

-- Add foreign keys
ALTER TABLE "Task" ADD CONSTRAINT "Task_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "TaskSchedule" ADD CONSTRAINT "TaskSchedule_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "Task"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "TaskPreference" ADD CONSTRAINT "TaskPreference_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "CalendarActionLog" ADD CONSTRAINT "CalendarActionLog_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
