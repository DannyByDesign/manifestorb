
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
            const { createLinkToken } = await import("@/server/utils/linking");
            const { env } = await import("@/env");

            const token = await createLinkToken({
                provider: message.provider,
                providerAccountId: message.context.userId,
                providerTeamId: (message.context as any).teamId, // If available
                metadata: {
                    channelId: message.context.channelId
                }
            });

            const linkUrl = `${env.NEXT_PUBLIC_BASE_URL}/link?token=${token}`;

            return [{
                targetChannelId: message.context.channelId,
                content: `Welcome! I don't recognize this ${message.provider} account yet.\n\nPlease [Link Your Account](${linkUrl}) to enable AI features.`,
                interactive: {
                    type: "approval_request", // Reusing this type for now to show a button if possible, but the link is primary
                    approvalId: "link-account",
                    summary: "Link Account",
                    actions: [
                        { label: "Link Account", style: "primary", value: linkUrl, url: linkUrl }
                    ]
                }
            }];
        }

        const user = account.user;
        const emailAccount = user.emailAccounts[0];

        // If no email account, we might have limited capability
        if (!emailAccount) {
            return [{
                targetChannelId: message.context.channelId,
                content: "Your account is linked, but you haven't connected a Gmail/Outlook account yet.\n\nPlease go to the Amodel Web App to connect your email."
            }];
        }

        // 2. Run Unified Agent
        try {
            const { runOneShotAgent } = await import("@/server/agent/executor");

            const { text, approvals } = await runOneShotAgent({
                user: user,
                emailAccount: emailAccount,
                message: message.content,
                context: {
                    channelId: message.context.channelId,
                    provider: message.provider,
                    userId: message.context.userId,
                    teamId: (message.context as any).teamId
                },
                history: message.history
            });

            // 3. Construct Output
            const outbound: OutboundMessage = {
                targetChannelId: message.context.channelId,
                content: text
            };

            // Attach interactive approval UI if generated
            if (approvals && approvals.length > 0) {
                const approval = approvals[0]; // Just show the first one for simplicity
                const { env } = await import("@/env");

                outbound.interactive = {
                    type: "approval_request",
                    approvalId: approval.id,
                    summary: "Approval Requested",
                    actions: [
                        { label: "Approve", style: "primary", value: "approve", url: `${env.NEXT_PUBLIC_BASE_URL}/approvals/${approval.id}` },
                        { label: "Deny", style: "danger", value: "deny" }
                    ]
                };
            }

            return [outbound];

        } catch (error) {
            logger.error("Error running agent", { error });
            return [{
                targetChannelId: message.context.channelId,
                content: "I encountered an error processing your request."
            }];
        }
    }
}
