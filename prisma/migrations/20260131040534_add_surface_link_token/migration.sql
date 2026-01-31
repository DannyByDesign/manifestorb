-- CreateTable
CREATE TABLE "SurfaceLinkToken" (
    "id" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "providerAccountId" TEXT NOT NULL,
    "providerTeamId" TEXT,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "consumedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "metadata" JSONB,

    CONSTRAINT "SurfaceLinkToken_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "SurfaceLinkToken_tokenHash_key" ON "SurfaceLinkToken"("tokenHash");

-- CreateIndex
CREATE INDEX "SurfaceLinkToken_provider_providerAccountId_expiresAt_idx" ON "SurfaceLinkToken"("provider", "providerAccountId", "expiresAt");
