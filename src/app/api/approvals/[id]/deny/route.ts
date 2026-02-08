
import { NextRequest, NextResponse } from "next/server";
import { ApprovalService } from "@/features/approvals/service";
import prisma from "@/server/db/client";
import { auth } from "@/server/auth";
import { createScopedLogger } from "@/server/lib/logger";
import { authorizeApprovalDecision } from "@/features/approvals/authorization";

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

        const authorization = await authorizeApprovalDecision({
            approvalRequestId: id,
            expectedAction: "deny",
            sessionUserId: session?.user?.id,
            token,
            logger,
        });

        if (!authorization.ok) {
            return NextResponse.json({ error: authorization.error }, { status: authorization.status });
        }
        const actingUserId = authorization.actingUserId;

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
