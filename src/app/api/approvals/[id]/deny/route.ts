
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

        if (request && request.user && request.user.emailAccounts[0]) {
            const { ChannelRouter } = await import("@/server/channels/router");
            const router = new ChannelRouter();
            const emailAccount = request.user.emailAccounts[0];
            const payload = request.requestPayload as { tool: string };
            const toolName = payload.tool || "action";

            let userMessage = "I've cancelled that request.";

            try {
                const { createGenerateText } = await import("@/server/utils/llms");
                const { getModel } = await import("@/server/utils/llms/model");

                const modelOptions = getModel(
                    request.user as any,
                    "chat"
                );

                const generator = createGenerateText({
                    emailAccount: emailAccount as any,
                    label: "approval_denial",
                    modelOptions
                });

                const { text } = await generator({
                    model: modelOptions.model,
                    prompt: `You are a helpful AI assistant. The user just DENIED/REJECTED a request to use the tool "${toolName}".
Write a brief, friendly, natural confirmation message acknowledging the cancellation.
Examples: "Understood, I've cancelled that." or "Okay, I won't send that email."
Max 1 sentence.`,
                });

                userMessage = text;
            } catch (llmError) {
                console.error("Failed to generate LLM denial msg", llmError);
            }

            await router.pushMessage(request.userId, `🚫 ${userMessage}`).catch(err => {
                console.error("Failed to send denial notification", err);
            });
        }

        return NextResponse.json(result);
    } catch (err) {
        return NextResponse.json(
            { error: err instanceof Error ? err.message : "Internal Server Error" },
            { status: 500 }
        );
    }
}
