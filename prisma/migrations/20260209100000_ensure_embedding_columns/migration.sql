-- Ensure pgvector and embedding columns exist (idempotent repair for DBs that missed earlier migrations)
CREATE EXTENSION IF NOT EXISTS vector;

ALTER TABLE "MemoryFact"
ADD COLUMN IF NOT EXISTS "embedding" vector(1536);

ALTER TABLE "Knowledge"
ADD COLUMN IF NOT EXISTS "embedding" vector(1536);

ALTER TABLE "ConversationMessage"
ADD COLUMN IF NOT EXISTS "embedding" vector(1536);

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_indexes
        WHERE indexname = 'MemoryFact_embedding_idx'
    ) THEN
        CREATE INDEX "MemoryFact_embedding_idx"
        ON "MemoryFact"
        USING ivfflat (embedding vector_cosine_ops)
        WITH (lists = 100);
    END IF;
END $$;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_indexes
        WHERE indexname = 'Knowledge_embedding_idx'
    ) THEN
        CREATE INDEX "Knowledge_embedding_idx"
        ON "Knowledge"
        USING ivfflat (embedding vector_cosine_ops)
        WITH (lists = 100);
    END IF;
END $$;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_indexes
        WHERE indexname = 'MemoryFact_userId_idx'
    ) THEN
        CREATE INDEX "MemoryFact_userId_idx"
        ON "MemoryFact" ("userId");
    END IF;
END $$;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_indexes
        WHERE indexname = 'Knowledge_emailAccountId_idx'
    ) THEN
        CREATE INDEX "Knowledge_emailAccountId_idx"
        ON "Knowledge" ("emailAccountId");
    END IF;
END $$;
