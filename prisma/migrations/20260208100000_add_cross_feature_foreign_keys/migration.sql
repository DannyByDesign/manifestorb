-- Add cross-feature foreign keys and source tracking (Issue 10)
-- All columns nullable; additive only.

-- Task: source tracking
ALTER TABLE "Task" ADD COLUMN "sourceEmailMessageId" TEXT;
ALTER TABLE "Task" ADD COLUMN "sourceConversationId" TEXT;
CREATE INDEX "Task_sourceEmailMessageId_idx" ON "Task"("sourceEmailMessageId");
ALTER TABLE "Task" ADD CONSTRAINT "Task_sourceEmailMessageId_fkey" FOREIGN KEY ("sourceEmailMessageId") REFERENCES "EmailMessage"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "Task" ADD CONSTRAINT "Task_sourceConversationId_fkey" FOREIGN KEY ("sourceConversationId") REFERENCES "Conversation"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Conversation: domain references
ALTER TABLE "Conversation" ADD COLUMN "relatedEmailThreadId" TEXT;
ALTER TABLE "Conversation" ADD COLUMN "relatedCalendarEventId" TEXT;

-- CalendarActionLog: email references
ALTER TABLE "CalendarActionLog" ADD COLUMN "relatedThreadId" TEXT;
ALTER TABLE "CalendarActionLog" ADD COLUMN "relatedMessageId" TEXT;
CREATE INDEX "CalendarActionLog_relatedThreadId_idx" ON "CalendarActionLog"("relatedThreadId");

-- ApprovalRequest: source tracking
ALTER TABLE "ApprovalRequest" ADD COLUMN "sourceType" TEXT;
ALTER TABLE "ApprovalRequest" ADD COLUMN "sourceId" TEXT;
CREATE INDEX "ApprovalRequest_sourceType_sourceId_idx" ON "ApprovalRequest"("sourceType", "sourceId");

-- DocumentFiling: task reference
ALTER TABLE "DocumentFiling" ADD COLUMN "relatedTaskId" TEXT;
ALTER TABLE "DocumentFiling" ADD CONSTRAINT "DocumentFiling_relatedTaskId_fkey" FOREIGN KEY ("relatedTaskId") REFERENCES "Task"("id") ON DELETE SET NULL ON UPDATE CASCADE;
