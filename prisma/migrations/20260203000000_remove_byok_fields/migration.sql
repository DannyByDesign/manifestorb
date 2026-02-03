-- Remove BYOK (Bring Your Own Key) fields from User table
-- Users will now only use system-provided AI routing

-- Drop the columns
ALTER TABLE "User" DROP COLUMN IF EXISTS "aiProvider";
ALTER TABLE "User" DROP COLUMN IF EXISTS "aiModel";
ALTER TABLE "User" DROP COLUMN IF EXISTS "aiApiKey";
