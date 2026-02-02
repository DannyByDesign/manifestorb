-- CreateTable
CREATE TABLE "UserSummary" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "summary" TEXT NOT NULL,
    "lastMessageAt" TIMESTAMP(3) NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "UserSummary_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "UserSummary_userId_key" ON "UserSummary"("userId");

-- CreateIndex
CREATE INDEX "UserSummary_userId_idx" ON "UserSummary"("userId");

-- AddForeignKey
ALTER TABLE "UserSummary" ADD CONSTRAINT "UserSummary_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
