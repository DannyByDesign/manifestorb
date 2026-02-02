
import { NextRequest, NextResponse } from "next/server";
import { ApprovalService } from "@/features/approvals/service";
import prisma from "@/server/db/client";
import { z } from "zod";
import { createScopedLogger } from "@/server/lib/logger";

const logger = createScopedLogger("api/approvals");

// Zod schema for approval creation params
const createApprovalParamsSchema = z.object({
    userId: z.string().min(1),
    provider: z.string().min(1),
    externalContext: z.record(z.string(), z.unknown()),
    requestPayload: z.object({
        actionType: z.string().min(1),
        description: z.string().min(1),
        args: z.record(z.string(), z.unknown()),
    }),
    idempotencyKey: z.string().min(1),
    expiresInSeconds: z.number().int().positive().optional(),
    correlationId: z.string().optional(),
});

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

        // Validate request body with Zod
        const parseResult = createApprovalParamsSchema.safeParse(body);
        if (!parseResult.success) {
            logger.warn("Invalid request body", { errors: parseResult.error.issues });
            return NextResponse.json(
                { error: "Invalid request body", details: parseResult.error.issues },
                { status: 400 }
            );
        }

        const service = new ApprovalService(prisma);
        const result = await service.createRequest(parseResult.data);

        return NextResponse.json(result);
    } catch (err) {
        logger.error("Error creating approval", { error: err });
        return NextResponse.json(
            { error: err instanceof Error ? err.message : "Internal Server Error" },
            { status: 500 }
        );
    }
}
