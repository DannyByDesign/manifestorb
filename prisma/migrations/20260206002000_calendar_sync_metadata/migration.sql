-- Add calendar sync metadata fields

ALTER TABLE "Calendar"
ADD COLUMN "googleChannelId" TEXT,
ADD COLUMN "googleResourceId" TEXT,
ADD COLUMN "googleChannelToken" TEXT,
ADD COLUMN "googleChannelExpiresAt" TIMESTAMP(3),
ADD COLUMN "googleSyncToken" TEXT,
ADD COLUMN "microsoftSubscriptionId" TEXT,
ADD COLUMN "microsoftSubscriptionExpiresAt" TIMESTAMP(3),
ADD COLUMN "microsoftDeltaToken" TEXT,
ADD COLUMN "microsoftClientState" TEXT;
