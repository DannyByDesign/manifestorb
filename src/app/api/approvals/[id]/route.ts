
import { NextRequest, NextResponse } from "next/server";
import { ApprovalService } from "@/features/approvals/service";
import prisma from "@/server/db/client";
import { auth } from "@/server/auth";
import { createScopedLogger } from "@/server/lib/logger";

const logger = createScopedLogger("approvals/get");

export async function GET(req: NextRequest, context: { params: Promise<{ id: string }> }) {
    const { id } = await context.params;

    // Authentication check
    const session = await auth();
    if (!session?.user?.id) {
        return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    try {
        // Verify the user has permission to view this approval
        const approvalRequest = await prisma.approvalRequest.findUnique({
            where: { id },
            select: { userId: true }
        });

        if (!approvalRequest) {
            return NextResponse.json({ error: "Approval request not found" }, { status: 404 });
        }

        if (approvalRequest.userId !== session.user.id) {
            logger.warn("User attempted to view another user's approval", {
                requestUserId: approvalRequest.userId,
                sessionUserId: session.user.id,
                approvalRequestId: id
            });
            return NextResponse.json({ error: "Forbidden" }, { status: 403 });
        }

        const service = new ApprovalService(prisma);
        const request = await service.getRequest(id);

        if (!request) {
            return NextResponse.json({ error: "Not Found" }, { status: 404 });
        }
        return NextResponse.json(request);
    } catch (err) {
        return NextResponse.json(
            { error: err instanceof Error ? err.message : "Internal Server Error" },
            { status: 500 }
        );
    }
}
