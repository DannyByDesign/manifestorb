-- Add embedding column to ConversationMessage for relevance-filtered history (Issue 24)
DO $$
DECLARE
    has_vector BOOLEAN;
BEGIN
    SELECT EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'vector')
    INTO has_vector;

    IF has_vector THEN
        ALTER TABLE "ConversationMessage"
        ADD COLUMN IF NOT EXISTS "embedding" vector(1536);
    ELSE
        RAISE NOTICE 'Skipping ConversationMessage.embedding because pgvector is unavailable.';
    END IF;
END $$;
