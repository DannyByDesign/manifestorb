
import { NextRequest, NextResponse } from "next/server";
import { ApprovalService } from "@/server/approvals/service";
import prisma from "@/server/db/client";

export async function POST(req: NextRequest, context: { params: Promise<{ id: string }> }) {
    const { id } = await context.params;
    try {
        const body = await req.json();
        const service = new ApprovalService(prisma);

        const result = await service.decideRequest({
            approvalRequestId: id,
            decidedByUserId: body.userId,
            decision: "DENY",
            reason: body.reason
        });

        return NextResponse.json(result);
    } catch (err) {
        return NextResponse.json(
            { error: err instanceof Error ? err.message : "Internal Server Error" },
            { status: 500 }
        );
    }
}
