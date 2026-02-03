
import { NextRequest, NextResponse } from "next/server";
import { ApprovalService } from "@/features/approvals/service";
import prisma from "@/server/db/client";
import { createScopedLogger } from "@/server/lib/logger";
import { auth } from "@/server/auth";

const logger = createScopedLogger("approvals/approve");

export async function POST(req: NextRequest, context: { params: Promise<{ id: string }> }) {
    const { id } = await context.params;

    // Authentication check
    const session = await auth();
    if (!session?.user?.id) {
        return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    try {
        const body = await req.json();
        const service = new ApprovalService(prisma);

        // Verify the user has permission to decide on this approval
        // (they should be the owner of the approval request)
        const approvalRequest = await prisma.approvalRequest.findUnique({
            where: { id },
            select: { userId: true }
        });

        if (!approvalRequest) {
            return NextResponse.json({ error: "Approval request not found" }, { status: 404 });
        }

        if (approvalRequest.userId !== session.user.id) {
            logger.warn("User attempted to approve another user's request", {
                requestUserId: approvalRequest.userId,
                sessionUserId: session.user.id,
                approvalRequestId: id
            });
            return NextResponse.json({ error: "Forbidden" }, { status: 403 });
        }

        // 1. Mark as Approved in DB
        const result = await service.decideRequest({
            approvalRequestId: id,
            decidedByUserId: session.user.id, // Use authenticated user ID, not body.userId
            decision: "APPROVE",
            reason: body.reason
        });

        // 2. Execute the Tool (The "Act" step)
        if (result.decision === "APPROVED") {
            // Fetch Request with Context
            const request = await prisma.approvalRequest.findUnique({
                where: { id },
                include: {
                    user: {
                        include: {
                            emailAccounts: {
                                take: 1, // Naive: user's primary email. In future, store emailAccountId in request context.
                                include: { account: true }
                            }
                        }
                    }
                }
            });

            if (!request || !request.user) {
                logger.error("Approval request or user not found after decision", { approvalRequestId: id });
                return NextResponse.json(result);
            }

            const emailAccount = request.user.emailAccounts[0];
            if (!emailAccount) {
                logger.error("No email account found for user during tool execution", { userId: request.userId });
                return NextResponse.json({ ...result, execution: "failed_no_email" });
            }

            const payload = request.requestPayload as { tool: string, args: any };
            const { tool: toolName, args } = payload;

            // Instantiate Tools
            const { createAgentTools } = await import("@/features/ai/tools");
            // Logger already initialized globally as 'logger'

            // We use a logger specific to this execution if needed, but the global one is fine.
            // Let's keep using 'logger' variable name.

            logger.info(`[Approval] Executing tool ${toolName} for user ${request.userId}`);

            const tools = await createAgentTools({
                emailAccount: emailAccount as any, // Generated types cast
                logger,
                userId: request.userId
            });

            const toolInstance = (tools as any)[toolName];
            if (!toolInstance) {
                logger.error(`Tool ${toolName} not found in agent tools`);
                return NextResponse.json({ ...result, execution: "failed_tool_not_found" });
            }

            // Execute!
            try {
                const executionResult = await toolInstance.execute(args);
                logger.info(`[Approval] Tool execution success:`, { executionResult });

                // Notify ChannelRouter of success (Push Notification)
                const { ChannelRouter } = await import("@/features/channels/router");
                const router = new ChannelRouter();

                let userMessage = "I've completed the request.";

                try {
                    const { createGenerateText } = await import("@/server/lib/llms");
                    const { getModel } = await import("@/server/lib/llms/model");

                    const modelOptions = getModel("chat");

                    const generator = createGenerateText({
                        emailAccount: emailAccount as any,
                        label: "approval_confirmation",
                        modelOptions
                    });

                    const { text } = await generator({
                        model: modelOptions.model,
                        prompt: `You are a helpful AI assistant. You just successfully executed a tool called "${toolName}" for the user. 
The execution result was: ${JSON.stringify(executionResult).slice(0, 500)}...
Write a brief, friendly, natural confirmation message to the user saying it's done. 
Examples: "I've sent that email for you." or "Updated your rules successfully." 
Do not imply you need anything else. Max 1 sentence.`
                    });

                    userMessage = text;
                } catch (llmError) {
                    logger.error("Failed to generate LLM confirmation msg, falling back to static", { error: llmError });
                    // Fallback logic
                    if (toolName === "reply") userMessage = "I've sent that email.";
                    else if (toolName.includes("rule")) userMessage = "I've updated your rules.";
                }

                await router.pushMessage(request.userId, `✅ ${userMessage}`).catch(err => {
                    logger.error("Failed to send approval notification", { error: err });
                });

                return NextResponse.json({ ...result, execution: executionResult });
            } catch (execError) {
                logger.error(`[Approval] Tool execution failed`, { error: execError });
                return NextResponse.json({ ...result, execution: "failed_exception", error: String(execError) });
            }
        }

        return NextResponse.json(result);
    } catch (err) {
        return NextResponse.json(
            { error: err instanceof Error ? err.message : "Internal Server Error" },
            { status: 500 }
        );
    }
}
