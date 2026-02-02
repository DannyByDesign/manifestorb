-- Enable pgvector extension (run as superuser if needed)
-- This may already be enabled in your database
CREATE EXTENSION IF NOT EXISTS vector;

-- Add embedding column to MemoryFact
ALTER TABLE "MemoryFact" 
ADD COLUMN IF NOT EXISTS "embedding" vector(1536);

-- Add embedding column to Knowledge
ALTER TABLE "Knowledge" 
ADD COLUMN IF NOT EXISTS "embedding" vector(1536);

-- Create indexes for fast similarity search
-- Using IVFFlat for approximate nearest neighbor (good balance of speed/accuracy)
-- Note: IVFFlat indexes need data to be built efficiently, so we create after data exists
-- For empty tables, HNSW might be better, but IVFFlat with lists=100 is a good default

-- Only create index if not exists (for re-running migrations)
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_indexes 
        WHERE indexname = 'MemoryFact_embedding_idx'
    ) THEN
        -- Using cosine distance operator for semantic similarity
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

-- Add composite index on userId + embedding for filtered searches on MemoryFact
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

-- Add composite index on emailAccountId for filtered searches on Knowledge
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
