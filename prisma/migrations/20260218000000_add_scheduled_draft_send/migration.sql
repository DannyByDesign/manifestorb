-- CreateEnum
CREATE TYPE "ScheduledDraftSendStatus" AS ENUM ('PENDING', 'SENDING', 'SENT', 'FAILED', 'CANCELLED');

-- CreateTable
CREATE TABLE "ScheduledDraftSend" (
    "id" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "userId" TEXT NOT NULL,
    "emailAccountId" TEXT NOT NULL,
    "draftId" TEXT NOT NULL,
    "sendAt" TIMESTAMP(3) NOT NULL,
    "status" "ScheduledDraftSendStatus" NOT NULL DEFAULT 'PENDING',
    "idempotencyKey" TEXT NOT NULL,
    "sourceConversationId" TEXT,
    "scheduledId" TEXT,
    "sentAt" TIMESTAMP(3),
    "messageId" TEXT,
    "threadId" TEXT,
    "lastError" TEXT,

    CONSTRAINT "ScheduledDraftSend_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ScheduledDraftSend_idempotencyKey_key" ON "ScheduledDraftSend"("idempotencyKey");

-- CreateIndex
CREATE INDEX "ScheduledDraftSend_status_sendAt_idx" ON "ScheduledDraftSend"("status", "sendAt");

-- CreateIndex
CREATE INDEX "ScheduledDraftSend_emailAccountId_draftId_idx" ON "ScheduledDraftSend"("emailAccountId", "draftId");

-- CreateIndex
CREATE INDEX "ScheduledDraftSend_userId_emailAccountId_idx" ON "ScheduledDraftSend"("userId", "emailAccountId");

-- AddForeignKey
ALTER TABLE "ScheduledDraftSend" ADD CONSTRAINT "ScheduledDraftSend_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ScheduledDraftSend" ADD CONSTRAINT "ScheduledDraftSend_emailAccountId_fkey" FOREIGN KEY ("emailAccountId") REFERENCES "EmailAccount"("id") ON DELETE CASCADE ON UPDATE CASCADE;
