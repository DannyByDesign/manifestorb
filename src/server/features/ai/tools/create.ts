
import { z } from "zod";
import { type ToolDefinition } from "./types";
import prisma from "@/server/db/client";
import { getEmailAccountWithAi } from "@/server/lib/user/get";
import { processAttachment } from "@/features/drive/filing-engine";
import { parseMessage } from "@/server/integrations/google/message";
import { ChannelRouter } from "@/features/channels/router";
import { generateNotification, type NotificationType } from "@/features/notifications/generator";
import { aiCollectReplyContext } from "@/features/reply-tracker/ai/reply-context-collector";
import { createScopedLogger } from "@/server/lib/logger";
import { isDefined } from "@/server/types";
import { type EmailForLLM, type MessageWithPayload } from "@/server/types";

const router = new ChannelRouter();
const logger = createScopedLogger("tools/create");

export const createTool: ToolDefinition<any> = {
    name: "create",
    description: `Create new items.
    
Email: Creates a DRAFT only. User must manually send from UI.
- type: "new" | "reply" | "forward"
- For reply/forward: provide parentId (thread ID / message ID)
- Returns: { draftId, previewUrl } for user to review and send

Calendar: Not implemented.

Automation: Create Rules & Knowledge supported.`,

    parameters: z.object({
        resource: z.enum(["email", "calendar", "automation", "knowledge", "drive", "notification", "contacts"]),
        type: z.enum(["new", "reply", "forward"]).optional(),
        parentId: z.string().optional(),
        data: z.object({
            // Email
            to: z.array(z.string()).optional(),
            cc: z.array(z.string()).optional(),
            bcc: z.array(z.string()).optional(),
            subject: z.string().optional(),
            body: z.string().optional(),

            // Calendar
            title: z.string().optional(),
            start: z.string().optional(),
            end: z.string().optional(),
            attendees: z.array(z.string()).optional(),
            location: z.string().optional(),

            // Automation
            name: z.string().optional(),
            conditions: z.any().optional(),
            actions: z.array(z.any()).optional(),

            // Knowledge
            // title uses Calendar's definition
            content: z.string().optional(),

            // Drive (Filing)
            messageId: z.string().optional(),
            attachmentId: z.string().optional(),

            // Notification (Push)
            type: z.enum(["email", "calendar", "system", "task"]).optional(),
            source: z.string().optional(),
            detail: z.string().optional(),
            // Title also used for notification

            // Contacts
            phone: z.string().optional(),
            company: z.string().optional(),
            jobTitle: z.string().optional(),
        }),
    }),



    execute: async ({ resource, type, parentId, data }, context) => {
        const { emailAccountId, providers } = context;
        switch (resource) {
            case "email":
                let replyContext = null;
                const isReply = type === "reply";

                if (isReply && parentId && providers.email) {
                    try {
                        const emailAccount = await getEmailAccountWithAi({ emailAccountId: context.emailAccountId });
                        if (emailAccount) {
                            const thread = await providers.email.getThread(parentId);
                            if (thread) {
                                const { getEmailForLLM } = await import("@/server/lib/get-email-from-message");
                                const threadLLM = thread.messages.map(m => getEmailForLLM(m));

                                const { createEmailProvider } = await import("@/features/email/provider");
                                const serviceProvider = await createEmailProvider({
                                    emailAccountId,
                                    provider: emailAccount.account.provider,
                                    logger
                                });

                                replyContext = await aiCollectReplyContext({
                                    currentThread: threadLLM,
                                    emailAccount,
                                    emailProvider: serviceProvider
                                });
                            }
                        }
                    } catch (err) {
                        logger.warn("Failed to collect reply context", { error: err });
                    }
                }

                // Map params to DraftParams
                const draftResult = await providers.email.createDraft({
                    type: (type as "new" | "reply" | "forward") || "new",
                    parentId,
                    to: data.to,
                    cc: data.cc,
                    bcc: data.bcc,
                    subject: data.subject,
                    body: data.body
                });

                return {
                    success: true,
                    data: {
                        ...draftResult,
                        replyContext
                    }
                };

            case "drive":
                if (!providers.drive) {
                    return { success: false, error: "Drive not connected" };
                }

                // 1. Create Folder
                if (data.name) {
                    const folder = await providers.drive.createFolder(data.name, parentId);
                    return { success: true, data: folder };
                }

                // 2. Document Filing
                if (!data.messageId || !data.attachmentId) {
                    return { success: false, error: "Message ID and Attachment ID required for filing, or Name for folder creation." };
                }

                // Hydrate
                const emailAccountFiling = await getEmailAccountWithAi({ emailAccountId: context.emailAccountId });
                if (!emailAccountFiling) return { success: false, error: "Email account not found" };

                // Fetch Message to get Attachment Metadata
                // Provider.get returns ParsedMessage[]
                const fileMessages = await providers.email.get([data.messageId]);
                if (!fileMessages || fileMessages.length === 0) return { success: false, error: "Message not found" };
                const fileMsg = fileMessages[0];

                // Find Attachment
                const attachment = fileMsg.attachments?.find((a: any) => a.attachmentId === data.attachmentId);
                if (!attachment) return { success: false, error: "Attachment not found" };

                // Create Service Provider for helper
                const { createEmailProvider: createFilingProvider } = await import("@/features/email/provider");
                const filingProvider = await createFilingProvider({
                    emailAccountId: context.emailAccountId,
                    provider: emailAccountFiling.account.provider,
                    logger
                });

                // Call Engine
                const filingResult = await processAttachment({
                    emailAccount: {
                        ...emailAccountFiling,
                        filingEnabled: true, // Force enable for agent tool usage? Or check settings?
                        filingPrompt: "File relevant documents",
                        email: emailAccountFiling.email
                    },
                    message: fileMsg,
                    attachment,
                    emailProvider: filingProvider,
                    logger,
                    sendNotification: true
                });

                return { success: filingResult.success, data: filingResult, error: filingResult.error };

            case "notification":
                // Push Notification
                if (!data.title || !data.detail || !data.type) {
                    return { success: false, error: "Title, detail, and type required for notification" };
                }

                // Hydrate
                const emailAccountNotif = await getEmailAccountWithAi({ emailAccountId: context.emailAccountId });
                if (!emailAccountNotif) return { success: false, error: "Email account not found" };

                // 1. Generate text (Agentic)
                const notifText = await generateNotification({
                    type: data.type as NotificationType,
                    source: data.source || "Agent",
                    title: data.title,
                    detail: data.detail,
                    importance: "medium"
                }, { emailAccount: emailAccountNotif });

                // 2. Push

                // 2. Schedule Omnichannel Notification
                const { createInAppNotification } = await import("@/features/notifications/create");
                await createInAppNotification({
                    userId: emailAccountNotif.userId,
                    title: data.title,
                    body: notifText,
                    type: "info",
                    metadata: {
                        source: data.source,
                        detail: data.detail,
                        type: data.type
                    }
                });

                return { success: true, data: { text: notifText, pushed: true } };

            case "calendar":
                return { success: false, error: "Calendar create not implemented" };

            case "automation":
                // Create Rule
                return {
                    success: true,
                    data: await providers.automation.createRule({
                        name: data.name,
                        conditions: data.conditions,
                        actions: data.actions
                    })
                };

            case "knowledge":
                // Create Knowledge Base Entry
                if (!data.title || !data.content) {
                    return { success: false, error: "Title and content required for knowledge" };
                }
                return {
                    success: true,
                    data: await providers.automation.createKnowledge({
                        title: data.title,
                        content: data.content
                    })
                };

            case "contacts":
                if (!data.name) return { success: false, error: "Name is required for creating a contact" };
                const contact = await providers.email.createContact({
                    name: data.name,
                    email: data.to?.[0],
                    phone: data.phone,
                    company: data.company,
                    jobTitle: data.jobTitle
                });
                return { success: true, data: contact };

            default:
                return { success: false, error: `Resource ${resource} not supported` };
        }
    },

    securityLevel: "CAUTION",
};
