
import { NextRequest, NextResponse } from "next/server";
import { ApprovalService } from "@/features/approvals/service";
import prisma from "@/server/db/client";
import { auth } from "@/server/auth";
import { createScopedLogger } from "@/server/lib/logger";
import {
    authorizeApprovalDecision,
    resolveSurfaceApprovalActor,
} from "@/features/approvals/authorization";
import { z } from "zod";

const logger = createScopedLogger("approvals/deny");

const approvalDecisionBodySchema = z
    .object({
        reason: z.string().optional(),
        provider: z.enum(["slack", "discord", "telegram", "web"]).optional(),
        userId: z.string().optional(),
    })
    .strict();

export async function POST(req: NextRequest, context: { params: Promise<{ id: string }> }) {
    const { id } = await context.params;

    const session = await auth();
    const token =
        req.nextUrl.searchParams.get("token") ||
        req.headers.get("x-approval-token");
    const surfaceSecret =
        req.headers.get("x-surfaces-secret") ||
        req.headers.get("authorization")?.replace("Bearer ", "");

    try {
        const rawBody = await req.json();
        const parsedBody = approvalDecisionBodySchema.safeParse(rawBody);
        if (!parsedBody.success) {
            return NextResponse.json(
                { error: "Invalid request body", details: parsedBody.error.issues },
                { status: 400 },
            );
        }
        const body = parsedBody.data;
        const service = new ApprovalService(prisma);

        let actingSessionUserId = session?.user?.id;
        if (!actingSessionUserId && !token) {
            const surfaceActor = await resolveSurfaceApprovalActor({
                provider: body.provider,
                providerAccountId: body.userId,
                providedSecret: surfaceSecret,
                logger,
            });
            if (surfaceActor && !surfaceActor.ok) {
                return NextResponse.json({ error: surfaceActor.error }, { status: surfaceActor.status });
            }
            if (surfaceActor?.ok) {
                actingSessionUserId = surfaceActor.userId;
            }
        }

        const authorization = await authorizeApprovalDecision({
            approvalRequestId: id,
            expectedAction: "deny",
            sessionUserId: actingSessionUserId,
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
        const msg = err instanceof Error ? err.message : String(err);
        const statusMatch = msg.match(/Cannot decide on request in status: (\w+)/);
        if (statusMatch) {
            const status = statusMatch[1];
            const alreadyProcessed = status === "APPROVED" || status === "DENIED";
            return NextResponse.json(
                {
                    message:
                        status === "EXPIRED"
                            ? "This approval request has expired. Please ask me to recreate the action."
                            : "This approval was already processed.",
                    decision: status,
                    alreadyProcessed,
                },
                { status: alreadyProcessed ? 200 : 409 },
            );
        }
        return NextResponse.json(
            { error: msg || "Internal Server Error" },
            { status: 500 }
        );
    }
}
