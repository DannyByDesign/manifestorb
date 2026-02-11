-- Create table only when missing. Older migrations may already have created it.
CREATE TABLE IF NOT EXISTS "Category" (
    "id" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "color" TEXT,
    "isSystem" BOOLEAN NOT NULL DEFAULT false,
    "isLearned" BOOLEAN NOT NULL DEFAULT false,
    "userId" TEXT NOT NULL,
    CONSTRAINT "Category_pkey" PRIMARY KEY ("id")
);

-- Align existing Category table shape with this migration.
ALTER TABLE "Category"
    ADD COLUMN IF NOT EXISTS "color" TEXT,
    ADD COLUMN IF NOT EXISTS "isSystem" BOOLEAN NOT NULL DEFAULT false,
    ADD COLUMN IF NOT EXISTS "isLearned" BOOLEAN NOT NULL DEFAULT false;

DO $$
BEGIN
    -- Old schema allowed NULL userId; remove null rows before enforcing NOT NULL.
    IF EXISTS (
        SELECT 1
        FROM information_schema.columns
        WHERE table_schema = 'public'
          AND table_name = 'Category'
          AND column_name = 'userId'
          AND is_nullable = 'YES'
    ) THEN
        DELETE FROM "Category" WHERE "userId" IS NULL;
        ALTER TABLE "Category" ALTER COLUMN "userId" SET NOT NULL;
    END IF;
END $$;

DO $$
BEGIN
    IF EXISTS (
        SELECT 1
        FROM information_schema.columns
        WHERE table_schema = 'public'
          AND table_name = 'Category'
          AND column_name = 'userId'
    ) AND NOT EXISTS (
        SELECT 1
        FROM pg_indexes
        WHERE schemaname = 'public'
          AND indexname = 'Category_userId_name_key'
    ) THEN
        CREATE UNIQUE INDEX "Category_userId_name_key" ON "Category"("userId", "name");
    END IF;
END $$;

DO $$
BEGIN
    IF EXISTS (
        SELECT 1
        FROM information_schema.columns
        WHERE table_schema = 'public'
          AND table_name = 'Category'
          AND column_name = 'userId'
    ) AND NOT EXISTS (
        SELECT 1
        FROM pg_indexes
        WHERE schemaname = 'public'
          AND indexname = 'Category_userId_idx'
    ) THEN
        CREATE INDEX "Category_userId_idx" ON "Category"("userId");
    END IF;
END $$;

DO $$
BEGIN
    IF EXISTS (
        SELECT 1
        FROM information_schema.columns
        WHERE table_schema = 'public'
          AND table_name = 'Category'
          AND column_name = 'userId'
    ) AND NOT EXISTS (
        SELECT 1
        FROM pg_constraint
        WHERE conname = 'Category_userId_fkey'
    ) THEN
        ALTER TABLE "Category"
        ADD CONSTRAINT "Category_userId_fkey"
        FOREIGN KEY ("userId") REFERENCES "User"("id")
        ON DELETE CASCADE ON UPDATE CASCADE;
    END IF;
END $$;
