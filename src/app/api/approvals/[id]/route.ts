
import { NextRequest, NextResponse } from "next/server";
import { ApprovalService } from "@/server/approvals/service";
import prisma from "@/server/db/client";

export async function GET(req: NextRequest, context: { params: Promise<{ id: string }> }) {
    const { id } = await context.params;
    try {
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
