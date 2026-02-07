-- Add embedding column to ConversationMessage for relevance-filtered history (Issue 24)
ALTER TABLE "ConversationMessage"
ADD COLUMN IF NOT EXISTS "embedding" vector(1536);
