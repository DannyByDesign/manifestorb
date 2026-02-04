-- Add temporary rule fields
ALTER TABLE "Rule"
ADD COLUMN "isTemporary" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN "expiresAt" TIMESTAMP(3);

CREATE INDEX "Rule_expiresAt_idx" ON "Rule"("expiresAt");
