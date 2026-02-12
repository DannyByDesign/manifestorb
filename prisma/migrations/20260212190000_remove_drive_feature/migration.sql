-- Remove Google Drive / document-filing data model from product scope

ALTER TABLE "EmailAccount"
  DROP COLUMN IF EXISTS "filingEnabled",
  DROP COLUMN IF EXISTS "filingPrompt";

DROP TABLE IF EXISTS "DocumentFiling" CASCADE;
DROP TABLE IF EXISTS "FilingFolder" CASCADE;
DROP TABLE IF EXISTS "DriveConnection" CASCADE;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_type WHERE typname = 'DocumentFilingStatus') THEN
    DROP TYPE "DocumentFilingStatus";
  END IF;
END
$$;
