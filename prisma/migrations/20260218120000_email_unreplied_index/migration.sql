-- Add composite index to support deterministic "sent but no reply" queries efficiently.
CREATE INDEX "EmailMessage_emailAccountId_sent_threadId_date_idx"
ON "EmailMessage"("emailAccountId", "sent", "threadId", "date");

