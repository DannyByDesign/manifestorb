
import { NextRequest, NextResponse } from "next/server";
import { executeApprovalRequest } from "@/features/approvals/execute";
import { verifyApprovalActionToken } from "@/features/approvals/action-token";
import prisma from "@/server/db/client";
import { createScopedLogger } from "@/server/lib/logger";
import { auth } from "@/server/auth";

const logger = createScopedLogger("approvals/approve");

export async function POST(req: NextRequest, context: { params: Promise<{ id: string }> }) {
    const { id } = await context.params;

    const session = await auth();
    const token =
        req.nextUrl.searchParams.get("token") ||
        req.headers.get("x-approval-token");

    try {
        const body = await req.json();
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
        if (tokenPayload && tokenPayload.action !== "approve") {
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
            logger.warn("User attempted to approve another user's request", {
                requestUserId: approvalRequest.userId,
                sessionUserId: session.user.id,
                approvalRequestId: id
            });
            return NextResponse.json({ error: "Forbidden" }, { status: 403 });
        }

        // 1. Mark as Approved in DB
        // 2. Decide + execute
        try {
            const execution = await executeApprovalRequest({
                approvalRequestId: id,
                decidedByUserId: actingUserId,
                reason: body.reason
            });

            const { decisionRecord, request, toolName, executionResult } = execution as any;

            if (decisionRecord?.decision !== "APPROVE") {
                return NextResponse.json(decisionRecord);
            }

            if (!request) {
                return NextResponse.json(decisionRecord);
            }

                // Notify ChannelRouter of success (Push Notification)
                const { ChannelRouter } = await import("@/features/channels/router");
                const router = new ChannelRouter();

                let userMessage = "I've completed the request.";

                try {
                    const { createGenerateText } = await import("@/server/lib/llms");
                    const { getModel } = await import("@/server/lib/llms/model");

                    const modelOptions = getModel("chat");

                    const { resolveEmailAccount } = await import("@/server/lib/user-utils");
                    const emailAccountForLlm = resolveEmailAccount(request.user, null);
                    if (emailAccountForLlm) {
                        const generator = createGenerateText({
                            emailAccount: emailAccountForLlm as any,
                            label: "approval_confirmation",
                            modelOptions
                        });

                        const { text } = await generator({
                            model: modelOptions.model,
                            prompt: `You are a helpful assistant. You just completed a user request. 
Details: ${JSON.stringify(executionResult).slice(0, 500)}...
Write a brief, friendly confirmation message saying it's done.
Do not mention tools or internal details. No emojis. Max 1 short sentence.`
                        });
                        userMessage = text;
                    }
                } catch (llmError) {
                    logger.error("Failed to generate LLM confirmation msg, falling back to static", { error: llmError });
                    // Fallback logic
                    if (toolName === "reply") userMessage = "I've sent that email.";
                    else if (toolName?.includes("rule")) userMessage = "I've updated your rules.";
                }

                await router.pushMessage(request.userId, `✅ ${userMessage}`).catch(err => {
                    logger.error("Failed to send approval notification", { error: err });
                });

            return NextResponse.json({ ...decisionRecord, execution: executionResult });
        } catch (execError) {
            const msg = execError instanceof Error ? execError.message : String(execError);
            if (msg.includes("Cannot decide on request in status: APPROVED") || msg.includes("Cannot decide on request in status: DENIED")) {
                return NextResponse.json({
                    message: "This approval was already processed.",
                    decision: msg.includes("APPROVED") ? "APPROVED" : "DENIED",
                    alreadyProcessed: true,
                });
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
