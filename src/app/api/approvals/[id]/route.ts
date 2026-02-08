
import { NextRequest, NextResponse } from "next/server";
import { ApprovalService } from "@/features/approvals/service";
import { auth } from "@/server/auth";
import { createScopedLogger } from "@/server/lib/logger";
import prisma from "@/server/db/client";
import { authorizeApprovalView } from "@/features/approvals/authorization";

const logger = createScopedLogger("approvals/get");

export async function GET(req: NextRequest, context: { params: Promise<{ id: string }> }) {
    const { id } = await context.params;

    const session = await auth();

    try {
        const authorization = await authorizeApprovalView({
            approvalRequestId: id,
            sessionUserId: session?.user?.id,
            logger,
        });

        if (!authorization.ok) {
            return NextResponse.json({ error: authorization.error }, { status: authorization.status });
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
