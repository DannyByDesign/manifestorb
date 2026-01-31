
import { NextRequest, NextResponse } from "next/server";
import { ApprovalService } from "@/server/approvals/service";
import prisma from "@/server/db/client";
import { CreateApprovalParams } from "@/server/approvals/types";

export async function POST(req: NextRequest) {
    try {
        const body = await req.json();
        const secret = req.headers.get("x-surfaces-secret");
        const bearer = req.headers.get("authorization")?.replace("Bearer ", "");
        // Only require auth if secret is set (to allow easy dev testing if unset, or enforce strictness)
        // For now, let's enforce if env var is set
        if (process.env.SURFACES_SHARED_SECRET && secret !== process.env.SURFACES_SHARED_SECRET && bearer !== process.env.SURFACES_SHARED_SECRET) {
            return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
        }

        const service = new ApprovalService(prisma);
        const result = await service.createRequest(body as CreateApprovalParams);

        return NextResponse.json(result);
    } catch (err) {
        return NextResponse.json(
            { error: err instanceof Error ? err.message : "Internal Server Error" },
            { status: 500 }
        );
    }
}
