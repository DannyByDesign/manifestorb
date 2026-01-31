import { generateText, tool, zodSchema } from "ai";
import { z } from "zod";
import prisma from "@/server/db/client";
import { createAgentTools } from "@/server/integrations/ai/tools";
import { getModel } from "@/server/utils/llms/model";
import { createGenerateText } from "@/server/utils/llms";
import { createScopedLogger } from "@/server/utils/logger";
import { ApprovalService } from "@/server/approvals/service";
import type { EmailAccount, User } from "@/generated/prisma/client";

const logger = createScopedLogger("AgentExecutor");

const AGENT_SYSTEM_PROMPT = `
You are an intelligent AI assistant for the Amodel platform.
You have access to a set of Agentic Tools to manage the user's Email and Calendar directly.

Agentic Tools:
- query: Search for emails or calendar events.
- get: Retrieve full details of specific items by ID.
- modify: Change the state of items (archive, trash, label, mark read).
- create: Create DRAFTS for new emails, replies, or forwards.
- delete: Trash items.
- analyze: Analyze content (summarize, extract actions).

Security & Safety:
- You operate in a CAUTION mode.
- Modifications (archive, delete, etc.) and Creations (drafts) often require USER APPROVAL.
- If a tool returns "Approval Required", you should inform the user that you have requested their approval.
- Do NOT hallucinate success if approval is pending.
`;

export async function runOneShotAgent({
    user,
    emailAccount,
    message,
    context,
    history
}: {
    user: User;
    emailAccount: EmailAccount;
    message: string;
    context: {
        channelId: string;
        provider: string; // "slack" | "discord" | "telegram"
        teamId?: string; // Optional (Slack)
        userId: string; // The specific provider User ID (e.g. U12345)
    };
    history?: { role: "user" | "assistant"; content: string }[];
}) {
    // 1. Setup Model
    // We treat the "Surfaces" bot as using the User's preferred model settings
    const modelOptions = getModel({
        aiProvider: user.aiProvider || "openai",
        aiModel: user.aiModel || "gpt-4-turbo", // Default fallback
        aiApiKey: user.aiApiKey,
    } as any);

    // 2. Setup Tools
    const baseTools = await createAgentTools({
        emailAccount: emailAccount as any,
        logger,
        userId: user.id,
    });

    const approvalService = new ApprovalService(prisma);

    // 3. Wrap Sensitive Tools
    // We want to intercept 'modify', 'create', 'delete'
    const sensitiveTools = ["modify", "create", "delete"];
    const tools: typeof baseTools = { ...baseTools };
    const createdApprovals: any[] = [];


    for (const name of sensitiveTools) {
        const toolName = name as keyof typeof baseTools;
        const originalTool = baseTools[toolName];

        if (originalTool) {
            // We recreate the tool with the same description and parameters but hijacked execute.
            tools[toolName] = tool({
                description: originalTool.description,
                parameters: zodSchema((originalTool as any).parameters) as any, // ZodSchema wrapper
                execute: async (args: any) => {
                    logger.info(`Intercepting tool ${toolName} for approval`);

                    // Create Approval Request
                    const requestPayload = {
                        actionType: "tool_execution",
                        description: `Execute tool ${toolName}`,
                        tool: toolName,
                        args: args as Record<string, any>
                    };

                    // Generate a unique idempotency key for this interaction to prevent dupes if retried quickly
                    // For now, we rely on the service to handle basic idempotency if key provided
                    const correlationId = `${context.provider}-${context.channelId}-${Date.now()}`;

                    const approval = await approvalService.createRequest({
                        userId: user.id,
                        provider: context.provider,
                        externalContext: context,
                        requestPayload,
                        correlationId,
                        // Expires in 1 hour
                        expiresInSeconds: 3600
                    } as any); // Cast to any because ApprovalService types might be slightly different

                    // Capture approval to return to UI
                    createdApprovals.push(approval);

                    return {
                        status: "approval_pending",
                        approvalId: approval.id,
                        message: "This action requires approval. A request has been sent."
                    };
                }
            } as any);
        }
    }

    // 4. Execute
    const generate = createGenerateText({
        emailAccount: {
            id: emailAccount.id,
            email: emailAccount.email,
            userId: user.id
        },
        label: `surfaces-${context.provider}`,
        modelOptions
    });

    // Construct messages with history
    const allMessages: any[] = [];
    if (history && history.length > 0) {
        allMessages.push(...history);
    }
    allMessages.push({ role: "user", content: message });

    const result = await generate({
        model: modelOptions.model,
        tools,
        maxSteps: 5, // Allow multi-step reasoning (e.g. search then summarize)
        system: `${AGENT_SYSTEM_PROMPT}

User Personal Instructions (Memory):
${emailAccount.about || "No personal instructions set."}
`,
        messages: allMessages,
    } as any);

    return {
        text: result.text,
        approvals: createdApprovals
    };
}
