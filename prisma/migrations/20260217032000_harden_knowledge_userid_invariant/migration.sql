-- Harden Knowledge ownership invariant in case older environments marked
-- previous restoration migrations as applied without converging schema state.
-- This migration is intentionally idempotent and forward-only.

ALTER TABLE "Knowledge"
ADD COLUMN IF NOT EXISTS "userId" TEXT;

UPDATE "Knowledge" k
SET "userId" = ea."userId"
FROM "EmailAccount" ea
WHERE k."userId" IS NULL
  AND k."emailAccountId" IS NOT NULL
  AND ea.id = k."emailAccountId";

-- Orphaned knowledge rows without a resolvable owner cannot satisfy the
-- application invariant (`Knowledge.userId` required). Remove them so deploys
-- and runtime retrieval remain healthy.
DELETE FROM "Knowledge" k
WHERE k."userId" IS NULL
  AND (
    k."emailAccountId" IS NULL
    OR NOT EXISTS (
      SELECT 1
      FROM "EmailAccount" ea
      WHERE ea.id = k."emailAccountId"
    )
  );

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
