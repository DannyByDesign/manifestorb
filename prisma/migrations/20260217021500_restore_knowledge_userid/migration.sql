-- Restore user-scoped ownership on Knowledge to support unified semantic retrieval.
-- Root cause fixed here: historical migrations dropped Knowledge.userId,
-- while current runtime/search layers require canonical user ownership.

ALTER TABLE "Knowledge"
ADD COLUMN IF NOT EXISTS "userId" TEXT;

UPDATE "Knowledge" k
SET "userId" = ea."userId"
FROM "EmailAccount" ea
WHERE k."userId" IS NULL
  AND k."emailAccountId" IS NOT NULL
  AND ea.id = k."emailAccountId";

DO $$
DECLARE
  missing_count BIGINT;
BEGIN
  SELECT COUNT(*) INTO missing_count
  FROM "Knowledge"
  WHERE "userId" IS NULL;

  IF missing_count > 0 THEN
    RAISE EXCEPTION
      'Cannot restore Knowledge.userId: % rows could not be mapped through emailAccountId',
      missing_count;
  END IF;
END
$$;

WITH ranked AS (
  SELECT
    id,
    ROW_NUMBER() OVER (
      PARTITION BY "userId", "title"
      ORDER BY "updatedAt" DESC, "createdAt" DESC, id DESC
    ) AS rn
  FROM "Knowledge"
)
DELETE FROM "Knowledge" k
USING ranked r
WHERE k.id = r.id
  AND r.rn > 1;

ALTER TABLE "Knowledge"
ALTER COLUMN "userId" SET NOT NULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'Knowledge_userId_fkey'
  ) THEN
    ALTER TABLE "Knowledge"
    ADD CONSTRAINT "Knowledge_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "User"("id")
    ON DELETE CASCADE
    ON UPDATE CASCADE;
  END IF;
END
$$;

DROP INDEX IF EXISTS "Knowledge_emailAccountId_title_key";

CREATE UNIQUE INDEX IF NOT EXISTS "Knowledge_userId_title_key"
ON "Knowledge" ("userId", "title");

CREATE INDEX IF NOT EXISTS "Knowledge_userId_idx"
ON "Knowledge" ("userId");
