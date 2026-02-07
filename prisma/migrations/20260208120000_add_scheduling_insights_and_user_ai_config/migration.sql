-- CreateTable
CREATE TABLE "SchedulingInsights" (
    "id" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "userId" TEXT NOT NULL,
    "avgMeetingDurationMin" DOUBLE PRECISION,
    "medianMeetingDurationMin" DOUBLE PRECISION,
    "avgBufferMin" DOUBLE PRECISION,
    "actualWorkHourStart" DOUBLE PRECISION,
    "actualWorkHourEnd" DOUBLE PRECISION,
    "activeWorkDays" INTEGER[] DEFAULT ARRAY[]::INTEGER[],
    "lastAnalyzedAt" TIMESTAMP(3),

    CONSTRAINT "SchedulingInsights_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "UserAIConfig" (
    "id" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "userId" TEXT NOT NULL,
    "maxSteps" INTEGER,
    "approvalInstructions" TEXT,
    "customInstructions" TEXT,
    "conversationCategories" TEXT[] DEFAULT ARRAY[]::TEXT[],

    CONSTRAINT "UserAIConfig_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "SchedulingInsights_userId_key" ON "SchedulingInsights"("userId");

-- CreateIndex
CREATE INDEX "SchedulingInsights_userId_idx" ON "SchedulingInsights"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "UserAIConfig_userId_key" ON "UserAIConfig"("userId");

-- AddForeignKey
ALTER TABLE "SchedulingInsights" ADD CONSTRAINT "SchedulingInsights_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UserAIConfig" ADD CONSTRAINT "UserAIConfig_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
