
import { InboundMessage, OutboundMessage } from "./types";
import { createScopedLogger } from "@/server/utils/logger";
import prisma from "@/server/db/client";
import { createGenerateText } from "@/server/utils/llms";
import { convertToCoreMessages, streamText } from "ai";
import { getModel } from "@/server/utils/llms/model";

const logger = createScopedLogger("ChannelRouter");

export class ChannelRouter {

    async handleInbound(message: InboundMessage): Promise<OutboundMessage[]> {
        logger.info("Handling inbound message", {
            provider: message.provider,
            userId: message.context.userId
        });

        // 0. Demo Bypass: Intercept "request approval" BEFORE auth check
        if (message.content.toLowerCase().includes("request approval")) {
            return [{
                targetChannelId: message.context.channelId,
                content: "I need your approval for this action.",
                interactive: {
                    type: "approval_request",
                    approvalId: "demo-request-123", // In real world this comes from ApprovalService.create
                    summary: "Demo Action: Deploy to Production",
                    actions: [
                        { label: "Approve", style: "primary", value: "approve" },
                        { label: "Deny", style: "danger", value: "deny" }
                    ]
                }
            }];
        }

        // 1. Fetch User via Account Link
        // We must look up the user by their external provider ID (Account table)
        // rather than assuming message.context.userId is already a UUID.

        const account = await prisma.account.findUnique({
            where: {
                provider_providerAccountId: {
                    provider: message.provider,
                    providerAccountId: message.context.userId
                }
            },
            include: {
                user: {
                    include: {
                        emailAccounts: {
                            take: 1, // Naive context: grab first email account
                            include: {
                                account: true
                            }
                        }
                    }
                }
            }
        });

        if (!account || !account.user) {
            return [{
                targetChannelId: message.context.channelId,
                content: `Account not linked. Please link your ${message.provider} account to continues.`
            }];
        }

        const user = account.user;
        const emailAccount = user.emailAccounts[0];

        // If no email account, we might have limited capability
        if (!emailAccount) {
            return [{
                targetChannelId: message.context.channelId,
                content: "No connected email account found for your user."
            }];
        }

        // 2. Prepare LLM Context
        const modelOptions = getModel(user, "chat");

        try {
            const { text } = await createGenerateText({
                emailAccount: emailAccount as any, // Cast for now, generic chat needs less
                label: "channel-chat",
                modelOptions
            })({
                ...modelOptions,
                messages: [
                    { role: "system", content: "You are a helpful AI assistant connected via " + message.provider + ". Answer the user's questions concisely." },
                    { role: "user", content: message.content }
                ]
            });

            // 3. Return Response
            return [{
                targetChannelId: message.context.channelId,
                content: text
            }];

        } catch (error) {
            logger.error("Error generating response", { error });
            return [{
                targetChannelId: message.context.channelId,
                content: "I encountered an error processing your request."
            }];
        }
    }
}
