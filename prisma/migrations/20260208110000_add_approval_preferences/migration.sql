-- CreateTable
CREATE TABLE "ApprovalPreference" (
    "id" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "userId" TEXT NOT NULL,
    "toolName" TEXT NOT NULL,
    "policy" TEXT NOT NULL,
    "conditions" JSONB,

    CONSTRAINT "ApprovalPreference_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ApprovalPreference_userId_toolName_key" ON "ApprovalPreference"("userId", "toolName");

-- CreateIndex
CREATE INDEX "ApprovalPreference_userId_idx" ON "ApprovalPreference"("userId");

-- AddForeignKey
ALTER TABLE "ApprovalPreference" ADD CONSTRAINT "ApprovalPreference_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
