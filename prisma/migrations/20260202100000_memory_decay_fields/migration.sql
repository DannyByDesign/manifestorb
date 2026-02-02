-- Memory Decay Fields Migration
-- Adds fields for memory lifecycle management:
-- - expiresAt: Optional TTL for time-sensitive facts
-- - lastAccessedAt: Track when fact was last retrieved (for LRU decay)
-- - accessCount: Track retrieval frequency
-- - isActive: Soft deletion flag

-- Add expiresAt column (optional TTL)
ALTER TABLE "MemoryFact"
ADD COLUMN IF NOT EXISTS "expiresAt" TIMESTAMP(3);

-- Add lastAccessedAt column (for LRU decay)
ALTER TABLE "MemoryFact"
ADD COLUMN IF NOT EXISTS "lastAccessedAt" TIMESTAMP(3);

-- Add accessCount column (usage tracking)
ALTER TABLE "MemoryFact"
ADD COLUMN IF NOT EXISTS "accessCount" INTEGER NOT NULL DEFAULT 0;

-- Add isActive column (soft deletion)
ALTER TABLE "MemoryFact"
ADD COLUMN IF NOT EXISTS "isActive" BOOLEAN NOT NULL DEFAULT true;

-- Create indexes for efficient queries

-- Index for filtering active facts
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_indexes
        WHERE indexname = 'MemoryFact_userId_isActive_idx'
    ) THEN
        CREATE INDEX "MemoryFact_userId_isActive_idx"
        ON "MemoryFact" ("userId", "isActive");
    END IF;
END $$;

-- Index for decay queries (finding stale facts)
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_indexes
        WHERE indexname = 'MemoryFact_userId_lastAccessedAt_idx'
    ) THEN
        CREATE INDEX "MemoryFact_userId_lastAccessedAt_idx"
        ON "MemoryFact" ("userId", "lastAccessedAt");
    END IF;
END $$;

-- Index for confidence-based filtering
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_indexes
        WHERE indexname = 'MemoryFact_userId_confidence_idx'
    ) THEN
        CREATE INDEX "MemoryFact_userId_confidence_idx"
        ON "MemoryFact" ("userId", "confidence");
    END IF;
END $$;

-- Index for expiration queries
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_indexes
        WHERE indexname = 'MemoryFact_expiresAt_idx'
    ) THEN
        CREATE INDEX "MemoryFact_expiresAt_idx"
        ON "MemoryFact" ("expiresAt")
        WHERE "expiresAt" IS NOT NULL;
    END IF;
END $$;
