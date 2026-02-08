
import { NextRequest, NextResponse } from "next/server";
import { ApprovalService } from "@/features/approvals/service";
import prisma from "@/server/db/client";
import { auth } from "@/server/auth";
import { createScopedLogger } from "@/server/lib/logger";
import { verifyApprovalActionToken } from "@/features/approvals/action-token";

const logger = createScopedLogger("approvals/deny");

export async function POST(req: NextRequest, context: { params: Promise<{ id: string }> }) {
    const { id } = await context.params;

    const session = await auth();
    const token =
        req.nextUrl.searchParams.get("token") ||
        req.headers.get("x-approval-token");

    try {
        const body = await req.json();
        const service = new ApprovalService(prisma);

        // Verify the user has permission to decide on this approval
        // (they should be the owner of the approval request)
        const approvalRequest = await prisma.approvalRequest.findUnique({
            where: { id },
            select: { userId: true }
        });

        if (!approvalRequest) {
            return NextResponse.json({ error: "Approval request not found" }, { status: 404 });
        }

        const tokenPayload = token ? verifyApprovalActionToken(token) : null;
        if (tokenPayload && tokenPayload.action !== "deny") {
            return NextResponse.json({ error: "Forbidden" }, { status: 403 });
        }

        if (tokenPayload && tokenPayload.approvalId !== id) {
            return NextResponse.json({ error: "Forbidden" }, { status: 403 });
        }

        const actingUserId = session?.user?.id || approvalRequest.userId;

        if (!session?.user?.id && !tokenPayload) {
            return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
        }

        if (session?.user?.id && approvalRequest.userId !== session.user.id) {
            logger.warn("User attempted to deny another user's request", {
                requestUserId: approvalRequest.userId,
                sessionUserId: session.user.id,
                approvalRequestId: id
            });
            return NextResponse.json({ error: "Forbidden" }, { status: 403 });
        }

        const result = await service.decideRequest({
            approvalRequestId: id,
            decidedByUserId: actingUserId, // Use authenticated user ID, not body.userId
            decision: "DENY",
            reason: body.reason
        });

        // Notify ChannelRouter of denial (Push Notification)
        // We need to fetch context first
        const request = await prisma.approvalRequest.findUnique({
            where: { id },
            include: {
                user: {
                    include: {
                        emailAccounts: {
                            take: 1,
                            include: { account: true }
                        }
                    }
                }
            }
        });

        if (request && request.user) {
            const { ChannelRouter } = await import("@/features/channels/router");
            const router = new ChannelRouter();

            await router.pushMessage(request.userId, "Denied. I cancelled that request.").catch(err => {
                logger.error("Failed to send denial notification", { error: err });
            });
        }

        return NextResponse.json(result);
    } catch (err) {
        return NextResponse.json(
            { error: err instanceof Error ? err.message : "Internal Server Error" },
            { status: 500 }
        );
    }
}
