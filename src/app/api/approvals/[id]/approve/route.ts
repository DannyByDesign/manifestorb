
import { NextRequest, NextResponse } from "next/server";
import { executeApprovalRequest } from "@/features/approvals/execute";
import { createScopedLogger } from "@/server/lib/logger";
import { auth } from "@/server/auth";
import {
    authorizeApprovalDecision,
    resolveSurfaceApprovalActor,
} from "@/features/approvals/authorization";
import { z } from "zod";

const logger = createScopedLogger("approvals/approve");

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
            expectedAction: "approve",
            sessionUserId: actingSessionUserId,
            token,
            logger,
        });

        if (!authorization.ok) {
            return NextResponse.json({ error: authorization.error }, { status: authorization.status });
        }
        const actingUserId = authorization.actingUserId;

        // 1. Mark as Approved in DB
        // 2. Decide + execute
        try {
            const execution = await executeApprovalRequest({
                approvalRequestId: id,
                decidedByUserId: actingUserId,
                reason: body.reason
            });

            const decisionRecord = execution.decisionRecord;
            const request = "request" in execution ? execution.request : undefined;
            const toolName = "toolName" in execution ? execution.toolName : undefined;
            const executionResult = "executionResult" in execution ? execution.executionResult : undefined;

            if (decisionRecord?.decision !== "APPROVE") {
                return NextResponse.json(decisionRecord);
            }

            if (!request) {
                return NextResponse.json(decisionRecord);
            }

            // Notify ChannelRouter of success (Push Notification)
            const { ChannelRouter } = await import("@/features/channels/router");
            const router = new ChannelRouter();

            const userMessage =
                toolName === "send"
                    ? "Approved. Your message has been sent."
                    : toolName === "create"
                        ? "Approved. I created that for you."
                        : toolName === "modify"
                            ? "Approved. I applied the update."
                            : toolName === "delete"
                                ? "Approved. I removed it."
                                : "Approved. I completed the request.";

            await router.pushMessage(request.userId, userMessage).catch(err => {
                logger.error("Failed to send approval notification", { error: err });
            });

            return NextResponse.json({ ...decisionRecord, execution: executionResult });
        } catch (execError) {
            const msg = execError instanceof Error ? execError.message : String(execError);
            const statusMatch = msg.match(/Cannot decide on request in status: (\w+)/);
            if (statusMatch) {
                const status = statusMatch[1];
                const alreadyProcessed = status === "APPROVED" || status === "DENIED";
                return NextResponse.json({
                    message:
                        status === "EXPIRED"
                            ? "This approval request has expired. Please ask me to recreate the action."
                            : "This approval was already processed.",
                    decision: status,
                    alreadyProcessed,
                }, { status: alreadyProcessed ? 200 : 409 });
            }
            logger.error(`[Approval] Tool execution failed`, { error: execError });
            return NextResponse.json({ execution: "failed_exception", error: msg }, { status: 500 });
        }
    } catch (err) {
        return NextResponse.json(
            { error: err instanceof Error ? err.message : "Internal Server Error" },
            { status: 500 }
        );
    }
}
