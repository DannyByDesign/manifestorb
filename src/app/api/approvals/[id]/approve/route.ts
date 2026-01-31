
import { NextRequest, NextResponse } from "next/server";
import { ApprovalService } from "@/server/approvals/service";
import prisma from "@/server/db/client";

export async function POST(req: NextRequest, context: { params: Promise<{ id: string }> }) {
    const { id } = await context.params;
    try {
        const body = await req.json();
        const service = new ApprovalService(prisma);

        // 1. Mark as Approved in DB
        const result = await service.decideRequest({
            approvalRequestId: id,
            decidedByUserId: body.userId, // In real app, this comes from auth session or verified callback
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
                console.error("Approval request or user not found after decision");
                return NextResponse.json(result);
            }

            const emailAccount = request.user.emailAccounts[0];
            if (!emailAccount) {
                console.error("No email account found for user during tool execution");
                return NextResponse.json({ ...result, execution: "failed_no_email" });
            }

            const payload = request.requestPayload as { tool: string, args: any };
            const { tool: toolName, args } = payload;

            console.log(`[Approval] Executing tool ${toolName} for user ${request.userId}`);

            // Instantiate Tools
            const { createAgentTools } = await import("@/server/integrations/ai/tools");
            const { createScopedLogger } = await import("@/server/utils/logger");

            // We use a logger specific to this execution
            const logger = createScopedLogger("ApprovalExecution");

            const tools = await createAgentTools({
                emailAccount: emailAccount as any, // Generated types cast
                logger,
                userId: request.userId
            });

            const toolInstance = (tools as any)[toolName];
            if (!toolInstance) {
                console.error(`Tool ${toolName} not found in agent tools`);
                return NextResponse.json({ ...result, execution: "failed_tool_not_found" });
            }

            // Execute!
            try {
                const executionResult = await toolInstance.execute(args);
                console.log(`[Approval] Tool execution success:`, executionResult);

                // TODO: Notify ChannelRouter of success (Push Notification equivalent)

                return NextResponse.json({ ...result, execution: executionResult });
            } catch (execError) {
                console.error(`[Approval] Tool execution failed`, execError);
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
