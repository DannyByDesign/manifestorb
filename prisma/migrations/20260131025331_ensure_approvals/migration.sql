/*
  Warnings:

  - The values [LEMON_SQUEEZY] on the enum `ProcessorType` will be removed. If these variants are still used in the database, this will fail.
  - You are about to drop the column `lemonLicenseInstanceId` on the `Premium` table. All the data in the column will be lost.
  - You are about to drop the column `lemonLicenseKey` on the `Premium` table. All the data in the column will be lost.
  - You are about to drop the column `lemonSqueezyCustomerId` on the `Premium` table. All the data in the column will be lost.
  - You are about to drop the column `lemonSqueezyOrderId` on the `Premium` table. All the data in the column will be lost.
  - You are about to drop the column `lemonSqueezyProductId` on the `Premium` table. All the data in the column will be lost.
  - You are about to drop the column `lemonSqueezyRenewsAt` on the `Premium` table. All the data in the column will be lost.
  - You are about to drop the column `lemonSqueezySubscriptionId` on the `Premium` table. All the data in the column will be lost.
  - You are about to drop the column `lemonSqueezySubscriptionItemId` on the `Premium` table. All the data in the column will be lost.
  - You are about to drop the column `lemonSqueezyVariantId` on the `Premium` table. All the data in the column will be lost.
  - You are about to drop the column `lemonSubscriptionStatus` on the `Premium` table. All the data in the column will be lost.

*/
-- AlterEnum
BEGIN;
CREATE TYPE "ProcessorType_new" AS ENUM ('STRIPE');
ALTER TABLE "public"."Payment" ALTER COLUMN "processorType" DROP DEFAULT;
ALTER TABLE "Payment" ALTER COLUMN "processorType" TYPE "ProcessorType_new" USING ("processorType"::text::"ProcessorType_new");
ALTER TYPE "ProcessorType" RENAME TO "ProcessorType_old";
ALTER TYPE "ProcessorType_new" RENAME TO "ProcessorType";
DROP TYPE "public"."ProcessorType_old";
ALTER TABLE "Payment" ALTER COLUMN "processorType" SET DEFAULT 'STRIPE';
COMMIT;

-- AlterTable
ALTER TABLE "Payment" ALTER COLUMN "processorType" SET DEFAULT 'STRIPE';

-- AlterTable
ALTER TABLE "Premium" DROP COLUMN "lemonLicenseInstanceId",
DROP COLUMN "lemonLicenseKey",
DROP COLUMN "lemonSqueezyCustomerId",
DROP COLUMN "lemonSqueezyOrderId",
DROP COLUMN "lemonSqueezyProductId",
DROP COLUMN "lemonSqueezyRenewsAt",
DROP COLUMN "lemonSqueezySubscriptionId",
DROP COLUMN "lemonSqueezySubscriptionItemId",
DROP COLUMN "lemonSqueezyVariantId",
DROP COLUMN "lemonSubscriptionStatus";

-- CreateTable
CREATE TABLE "ApprovalRequest" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "externalContext" JSONB NOT NULL,
    "requestPayload" JSONB NOT NULL,
    "payloadHash" TEXT NOT NULL,
    "idempotencyKey" TEXT NOT NULL,
    "correlationId" TEXT,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ApprovalRequest_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ApprovalDecision" (
    "id" TEXT NOT NULL,
    "approvalRequestId" TEXT NOT NULL,
    "decidedByUserId" TEXT NOT NULL,
    "decision" TEXT NOT NULL,
    "decisionPayload" JSONB,
    "decidedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ApprovalDecision_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ApprovalRequest_idempotencyKey_key" ON "ApprovalRequest"("idempotencyKey");

-- CreateIndex
CREATE INDEX "ApprovalRequest_userId_idx" ON "ApprovalRequest"("userId");

-- CreateIndex
CREATE INDEX "ApprovalRequest_status_idx" ON "ApprovalRequest"("status");

-- CreateIndex
CREATE INDEX "ApprovalRequest_expiresAt_idx" ON "ApprovalRequest"("expiresAt");

-- CreateIndex
CREATE INDEX "ApprovalDecision_approvalRequestId_idx" ON "ApprovalDecision"("approvalRequestId");

-- CreateIndex
CREATE INDEX "ApprovalDecision_decidedByUserId_idx" ON "ApprovalDecision"("decidedByUserId");

-- AddForeignKey
ALTER TABLE "ApprovalRequest" ADD CONSTRAINT "ApprovalRequest_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ApprovalDecision" ADD CONSTRAINT "ApprovalDecision_approvalRequestId_fkey" FOREIGN KEY ("approvalRequestId") REFERENCES "ApprovalRequest"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ApprovalDecision" ADD CONSTRAINT "ApprovalDecision_decidedByUserId_fkey" FOREIGN KEY ("decidedByUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- RenameIndex
ALTER INDEX "ThreadTracker_emailAccountId_type_resolved_followUpAppliedAt_id" RENAME TO "ThreadTracker_emailAccountId_type_resolved_followUpAppliedA_idx";
