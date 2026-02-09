
import { PrismaClient, ApprovalRequest, ApprovalDecision, Prisma } from "@/generated/prisma/client";
import { createHash } from "crypto";
import { CreateApprovalParams, DecideApprovalParams } from "./types";
import { createScopedLogger } from "@/server/lib/logger";
import prisma from "@/server/db/client";

const logger = createScopedLogger("ApprovalService");
const DEFAULT_EXPIRY_SECONDS = 86_400; // 24 hours

/**
 * Get the approval request expiry in seconds for a user (from UserAIConfig or default).
 */
export async function getApprovalExpiry(userId: string): Promise<number> {
  const config = await prisma.userAIConfig.findUnique({
    where: { userId },
    select: { defaultApprovalExpirySeconds: true },
  });
  return config?.defaultApprovalExpirySeconds ?? DEFAULT_EXPIRY_SECONDS;
}

export class ApprovalService {
    constructor(private prisma: PrismaClient) { }

    /**
     * Create a new approval request.
     * Idempotent: If a request with the same idempotencyKey exists, returns it.
     */
    async createRequest(params: CreateApprovalParams): Promise<ApprovalRequest> {
        const {
            userId,
            provider,
            externalContext,
            requestPayload,
            idempotencyKey,
            expiresInSeconds,
            correlationId,
            sourceType,
            sourceId,
        } = params;

        // Check for existing request (Idempotency)
        const existing = await this.prisma.approvalRequest.findUnique({
            where: { idempotencyKey },
        });

        if (existing) {
            logger.info(`Returning existing approval request for key: ${idempotencyKey}`);
            return existing;
        }

        const payloadString = JSON.stringify(requestPayload);
        const payloadHash = createHash("sha256").update(payloadString).digest("hex");
        const expiresAt = new Date(Date.now() + (expiresInSeconds || DEFAULT_EXPIRY_SECONDS) * 1000);

        const request = await this.prisma.approvalRequest.create({
            data: {
                userId,
                provider,
                externalContext: externalContext as Prisma.InputJsonValue,
                requestPayload: requestPayload as Prisma.InputJsonValue,
                status: "PENDING",
                payloadHash,
                idempotencyKey,
                correlationId,
                expiresAt,
                sourceType,
                sourceId,
            }
        });

        logger.info(`Created approval request ${request.id} for user ${userId}`);
        return request;
    }

    /**
     * Get an approval request by ID.
     */
    async getRequest(id: string): Promise<ApprovalRequest | null> {
        return this.prisma.approvalRequest.findUnique({
            where: { id },
            include: { decisions: true }
        });
    }

    /**
     * Decide on an approval request (APPROVE or DENY).
     */
    async decideRequest(params: DecideApprovalParams): Promise<ApprovalDecision> {
        const { approvalRequestId, decidedByUserId, decision, reason } = params;

        return await this.prisma.$transaction(async (tx: Prisma.TransactionClient) => {
            const request = await tx.approvalRequest.findUnique({
                where: { id: approvalRequestId },
            });

            if (!request) {
                throw new Error("Approval request not found");
            }

            if (request.userId !== decidedByUserId) {
                throw new Error("Forbidden: approval request does not belong to user");
            }

            if (request.status !== "PENDING") {
                throw new Error(`Cannot decide on request in status: ${request.status}`);
            }

            if (new Date() > request.expiresAt) {
                logger.warn("Approval request past expiry at decision time; honoring explicit user decision", {
                    approvalRequestId,
                    decidedByUserId,
                    decision,
                    expiredAt: request.expiresAt.toISOString(),
                    decidedAt: new Date().toISOString(),
                });
            }

            // Update Request Status
            const newStatus = decision === "APPROVE" ? "APPROVED" : "DENIED";
            await tx.approvalRequest.update({
                where: { id: approvalRequestId },
                data: { status: newStatus }
            });

            // Create Decision Record
            const decisionRecord = await tx.approvalDecision.create({
                data: {
                    approvalRequestId,
                    decidedByUserId,
                    decision,
                    decisionPayload: reason ? { reason } : {},
                }
            });

            logger.info(`Request ${approvalRequestId} ${newStatus} by user ${decidedByUserId}`);
            return decisionRecord;
        });
    }
}
