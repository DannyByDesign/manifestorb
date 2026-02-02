
import { z } from "zod";
import { type ToolDefinition } from "./types";
import { ApprovalService } from "@/features/approvals/service";
import prisma from "@/server/db/client";
import { createEmailProvider } from "@/features/email/provider";
import { updateThreadTrackers } from "@/features/reply-tracker/handle-conversation-status";
import { ThreadTrackerType } from "@/generated/prisma/client";
import { getEmailAccountWithAi } from "@/server/lib/user/get";
import { internalDateToDate } from "@/server/lib/date";

const approvalService = new ApprovalService(prisma);

export const modifyTool: ToolDefinition<any> = {
    name: "modify",
    description: `Modify existing items.
    
Email changes:
- archive: boolean (move to/from archive)
- trash: boolean (move to/from trash) -- prefer delete tool for trashing
- read: boolean (mark read/unread)
- labels: { add?: string[], remove?: string[] }
- bulk_archive_senders: boolean (archive all from these senders)
- bulk_trash_senders: boolean (trash all from these senders)
- bulk_trash_senders: boolean (trash all from these senders)
- bulk_label_senders: string (label name to apply to all from these senders)
- followUp: "enable" | "disable" (mark thread for follow-up detection)

Calendar changes:
- Not yet implemented`,

    parameters: z.object({
        resource: z.enum([
            "email", "calendar", "automation", "preferences", "approval", "drive"
        ]),
        ids: z.array(z.string()).max(50).optional(),
        changes: z.record(z.string(), z.any()),
    }),

    execute: async ({ resource, ids, changes }, { emailAccountId, logger, providers }) => {
        switch (resource) {
            case "email":
                if (!ids || ids.length === 0) return { success: false, error: "No IDs provided" };

                // Handle Unsubscribe special case
                if (changes.unsubscribe) {
                    const emails = await providers.email.get(ids);
                    if (emails.length === 0) return { success: false, error: "Emails not found" };

                    const results = await Promise.all(emails.map(async (email) => {
                        const senderEmail = email.headers.from.match(/<(.+)>/)?.[1] || email.headers.from;
                        return providers.automation.unsubscribe(senderEmail);
                    }));

                    const successCount = results.filter(r => r.success).length;
                    return {
                        success: true,
                        data: {
                            action: "unsubscribe",
                            attempted: results.length,
                            succeeded: successCount,
                            details: results
                        }
                    };
                }

                // Handle Reply Tracking
                if (changes.tracking === true || changes.tracking === false) {
                    const emailAccount = await getEmailAccountWithAi({ emailAccountId });
                    if (!emailAccount) return { success: false, error: "Email account not found" };

                    let setupCount = 0;
                    for (const id of ids) {
                        const messages = await providers.email.get([id]);
                        if (messages.length > 0) {
                            const msg = messages[0];
                            if (changes.tracking === true) {
                                // Enable Tracking (AWAITING_REPLY behavior)
                                await updateThreadTrackers({
                                    emailAccountId,
                                    threadId: msg.threadId,
                                    messageId: msg.id,
                                    sentAt: internalDateToDate(msg.internalDate),
                                    status: "AWAITING_REPLY"
                                });
                                setupCount++;
                            } else {
                                await updateThreadTrackers({
                                    emailAccountId,
                                    threadId: msg.threadId,
                                    messageId: msg.id,
                                    sentAt: internalDateToDate(msg.internalDate),
                                    status: "FYI"
                                });
                                setupCount++;
                            }
                        }
                    }
                    return { success: true, count: setupCount };
                }

                // Handle Follow Up
                if (changes.followUp) {
                    const mode = changes.followUp as "enable" | "disable";
                    if (!["enable", "disable"].includes(mode)) return { success: false, error: "followUp must be 'enable' or 'disable'" };

                    const { applyFollowUpLabel, removeFollowUpLabel } = await import("@/features/follow-up/labels");
                    const emails = await providers.email.get(ids);
                    if (emails.length === 0) return { success: false, error: "Emails not found" };

                    // Instantiate Service Provider to satisfy EmailProvider interface
                    const emailAccount = await getEmailAccountWithAi({ emailAccountId });
                    if (!emailAccount) return { success: false, error: "Email account not found" };

                    const serviceProvider = await createEmailProvider({
                        emailAccountId,
                        provider: emailAccount.account.provider,
                        logger
                    });

                    const threadsProcessed = new Set<string>();
                    let count = 0;

                    for (const email of emails) {
                        if (threadsProcessed.has(email.threadId)) continue;

                        if (mode === "enable") {
                            await applyFollowUpLabel({
                                provider: serviceProvider,
                                threadId: email.threadId,
                                messageId: email.id,
                                logger
                            });
                        } else {
                            await removeFollowUpLabel({
                                provider: serviceProvider,
                                threadId: email.threadId,
                                logger
                            });
                        }
                        threadsProcessed.add(email.threadId);
                        count++;
                    }
                    return { success: true, count, message: `Follow-up ${mode}d for ${count} threads` };
                }

                // Handle Bulk Archive
                if (changes.bulk_archive_senders) {
                    const emails = await providers.email.get(ids);
                    if (emails.length === 0) return { success: false, error: "Emails not found" };

                    const senders = new Set<string>();
                    emails.forEach(e => {
                        const match = e.headers.from.match(/<(.+)>/);
                        const email = match ? match[1] : e.headers.from;
                        if (email) senders.add(email);
                    });

                    // Use Service Provider for Bulk Actions
                    const emailAccount = await getEmailAccountWithAi({ emailAccountId });
                    if (!emailAccount) return { success: false, error: "Email account not found" };

                    const serviceProvider = await createEmailProvider({
                        emailAccountId,
                        provider: emailAccount.account.provider,
                        logger
                    });
                    await serviceProvider.bulkArchiveFromSenders(Array.from(senders), emailAccount.email, emailAccountId);

                    return { success: true, count: senders.size, message: `Bulk archived senders: ${Array.from(senders).join(", ")}` };
                }

                // Handle Bulk Trash
                if (changes.bulk_trash_senders) {
                    const emails = await providers.email.get(ids);
                    if (emails.length === 0) return { success: false, error: "Emails not found" };

                    const senders = new Set<string>();
                    emails.forEach(e => {
                        // Extract email from "Name <email>" or just "email"
                        const match = e.headers.from.match(/<(.+)>/);
                        const email = match ? match[1] : e.headers.from;
                        if (email) senders.add(email);
                    });

                    // Use Service Provider for Bulk Actions
                    const emailAccount = await getEmailAccountWithAi({ emailAccountId });
                    if (!emailAccount) return { success: false, error: "Email account not found" };

                    const serviceProvider = await createEmailProvider({
                        emailAccountId,
                        provider: emailAccount.account.provider,
                        logger
                    });
                    await serviceProvider.bulkTrashFromSenders(Array.from(senders), emailAccount.email, emailAccountId);

                    return { success: true, count: senders.size, message: `Bulk trashed senders: ${Array.from(senders).join(", ")}` };
                }

                // Handle Bulk Label
                if (changes.bulk_label_senders && typeof changes.bulk_label_senders === "string") {
                    const labelName = changes.bulk_label_senders;
                    const emails = await providers.email.get(ids);
                    if (emails.length === 0) return { success: false, error: "Emails not found" };

                    const senders = new Set<string>();
                    emails.forEach(e => {
                        const match = e.headers.from.match(/<(.+)>/);
                        const email = match ? match[1] : e.headers.from;
                        if (email) senders.add(email);
                    });

                    const emailAccount = await getEmailAccountWithAi({ emailAccountId });
                    if (!emailAccount) return { success: false, error: "Email account not found" };

                    const serviceProvider = await createEmailProvider({
                        emailAccountId,
                        provider: emailAccount.account.provider,
                        logger
                    });
                    await serviceProvider.bulkLabelFromSenders(Array.from(senders), emailAccount.email, emailAccountId, labelName);

                    return { success: true, count: senders.size, message: `Bulk labeled senders with '${labelName}': ${Array.from(senders).join(", ")}` };
                }

                return {
                    success: true,
                    data: await providers.email.modify(ids, changes),
                };

            case "approval":
                if (!ids || ids.length === 0) return { success: false, error: "No Approval Request ID provided" };
                const decision = changes.decision as "APPROVE" | "DENY";
                const reason = changes.reason as string;

                if (!decision) return { success: false, error: "Decision (APPROVE/DENY) required" };

                // Get User ID from context (Approver)
                const emailAccountApp = await getEmailAccountWithAi({ emailAccountId });
                if (!emailAccountApp) return { success: false, error: "User not found" };

                const approvalResults = await Promise.all(ids.map((id: string) =>
                    approvalService.decideRequest({
                        approvalRequestId: id,
                        decidedByUserId: emailAccountApp.userId,
                        decision,
                        reason
                    })
                ));

                return { success: true, data: approvalResults };

            case "calendar":
                return { success: false, error: "Calendar modify not implemented" };

            case "automation":
                if (!ids || ids.length === 0) return { success: false, error: "No Rule ID provided" };
                const results = await Promise.all(ids.map((id: string) =>
                    providers.automation.updateRule(id, changes)
                ));
                return { success: true, data: results };

            case "drive":
                if (!providers.drive) {
                    return { success: false, error: "Drive not connected" };
                }
                if (!ids || ids.length === 0) return { success: false, error: "No File IDs provided" };

                // Move File
                if (changes.targetFolderId) {
                    const moveResults = await Promise.all(ids.map((id: string) =>
                        providers.drive!.moveFile(id, changes.targetFolderId!)
                    ));
                    return { success: true, data: moveResults };
                }

                return { success: false, error: "Only move (targetFolderId) supported for Drive" };

            case "marketing":
            case "notification":
            case "knowledge":
            case "preferences":
                return { success: false, error: "Modifying this resource not supported yet" };

            default:
                return { success: false, error: `Resource ${resource} not supported` };
        }
    },

    securityLevel: "CAUTION",
};
