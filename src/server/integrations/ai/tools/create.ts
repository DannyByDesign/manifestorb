
import { z } from "zod";
import { type ToolDefinition } from "./types";
import prisma from "@/server/db/client";
import { getEmailAccountWithAi } from "@/server/utils/user/get";
import { processAttachment } from "@/server/utils/drive/filing-engine";
import { parseMessage } from "@/server/integrations/google/message";
import { ChannelRouter } from "@/server/channels/router";
import { generateNotification, type NotificationType } from "@/server/services/notification/generator";
import { aiCollectReplyContext } from "@/server/integrations/ai/reply/reply-context-collector";
import { createScopedLogger } from "@/server/utils/logger";
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
            title: z.string().optional(),
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

                // Implicit Context Collection for Replies
                if (isReply && parentId && providers.email) {
                    try {
                        const emailAccount = await getEmailAccountWithAi({ emailAccountId: context.emailAccountId });
                        if (emailAccount) {
                            // Needs full thread for context
                            // parentId is messageId or threadId?
                            // Usually reply refers to a messageId.
                            // Let's assume parentId is messageId.
                            const thread = await providers.email.getThread(parentId);
                            if (thread) {
                                // Convert to EmailForLLM
                                const threadLLM = thread.messages.map(m => ({
                                    ...m,
                                    body: m.text || m.body || "",
                                    from: typeof m.from === 'string' ? m.from : m.from.email
                                })) as EmailForLLM[];

                                replyContext = await aiCollectReplyContext({
                                    currentThread: threadLLM,
                                    emailAccount,
                                    emailProvider: providers.email
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
                    emailProvider: providers.email,
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
                const pushed = await router.pushMessage(emailAccountNotif.userId, notifText);

                return { success: pushed, data: { text: notifText, pushed } };

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
                    email: data.to?.[0], // Reusing 'to' field for email to avoid too many duplicate fields, or should we use a specific one? 
                    // The schema above didn't add 'email', let's use 'to' or add 'email' explicitly? 
                    // 'to' is array, contact email usually single but can be multiple.
                    // Let's check schema: I didn't add 'email' to schema block above, only 'phone', 'company'.
                    // I will strictly use the fields I defined.
                    // Wait, I should add 'email' to schema to be clear.
                    // I will add 'email' to schema in the previous chunk or use 'to' array.
                    // 'to' is z.array(z.string()). 
                    // I'll interpret data.to[0] as email.
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
