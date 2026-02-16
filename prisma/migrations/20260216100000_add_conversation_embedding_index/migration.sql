-- Add ivfflat index for ConversationMessage.embedding to improve semantic recall latency.
DO $$
DECLARE
    has_vector BOOLEAN;
BEGIN
    SELECT EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'vector')
    INTO has_vector;

    IF has_vector THEN
        IF NOT EXISTS (
            SELECT 1 FROM pg_indexes
            WHERE indexname = 'ConversationMessage_embedding_idx'
        ) THEN
            CREATE INDEX "ConversationMessage_embedding_idx"
            ON "ConversationMessage"
            USING ivfflat (embedding vector_cosine_ops)
            WITH (lists = 100);
        END IF;
    ELSE
        RAISE NOTICE 'Skipping ConversationMessage embedding index because pgvector is unavailable.';
    END IF;
END $$;
