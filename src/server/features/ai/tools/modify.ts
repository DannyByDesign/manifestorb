/**
 * AI Tool: modify
 *
 * Wraps server actions / equivalents:
 * - email: archiveThreadAction, trashThreadAction, markReadThreadAction (via provider)
 * - automation: updateRuleAction, toggleRuleAction (enabled, instructions)
 * - preferences: applyDigestSchedule, applyToggleDigest, applyEmailSettings (Issue 08)
 * - approval: ApprovalService.decideRequest, resolveScheduleProposalRequestById
 */

import { z } from "zod";
import { type ToolDefinition } from "./types";
import { ApprovalService } from "@/features/approvals/service";
import prisma from "@/server/db/client";
import { createEmailProvider } from "@/features/email/provider";
import { updateThreadTrackers } from "@/features/reply-tracker/handle-conversation-status";
import { ThreadTrackerType } from "@/generated/prisma/client";
import { getEmailAccountWithAi } from "@/server/lib/user/get";
import { internalDateToDate } from "@/server/lib/date";
import { scheduleTasksForUser } from "@/features/calendar/scheduling/TaskSchedulingService";
import { isAmbiguousLocalTime, resolveTimeZoneOrUtc } from "@/features/calendar/scheduling/date-utils";
import { createHash } from "crypto";

const approvalService = new ApprovalService(prisma);

export const modifyTool: ToolDefinition<any> = {
    name: "modify",
    description: `Modify existing items.

Approval (use when user confirms a pending request from Pending State):
- resource: "approval", ids: [approval request id], changes: { decision: "APPROVE" | "DENY", reason?: string }
- For a pending schedule proposal, use changes: { choiceIndex: 0 } for the first slot, 1 for the second, 2 for the third. That resolves the proposal and creates the event.
- Use decision APPROVE when the user says yes, approve, send it, or similar for send/other approvals.

Email changes:
- archive: boolean (move to/from archive)
- trash: boolean (move to/from trash) -- prefer delete tool for trashing
- read: boolean (mark read/unread)
- labels: { add?: string[], remove?: string[] }
- bulk_archive_senders: boolean (archive all from these senders)
- bulk_trash_senders: boolean (trash all from these senders)
- bulk_label_senders: string (label name to apply to all from these senders)
- followUp: "enable" | "disable" (mark thread for follow-up detection)

Calendar changes:
- title, description, location, start, end, allDay, isRecurring, recurrenceRule, timeZone
- mode: "single" | "series"
- calendarId (optional)

Task changes:
- title, description, durationMinutes, status, priority, energyLevel, preferredTime
- dueDate, startDate, scheduledStart, scheduledEnd
- isAutoScheduled, scheduleLocked, reschedulePolicy
- scheduleNow: true (trigger scheduling run)

Preferences changes:
- digestEnabled: boolean (enable/disable daily digest)
- digestTime: ISO date string (time of day for digest, e.g. "2026-01-01T09:00:00")
- digestSchedule: { intervalDays, daysOfWeek, timeOfDay, occurrences }
- statsEmailFrequency: "WEEKLY" | "NEVER"
- summaryEmailFrequency: "WEEKLY" | "NEVER"`,

    parameters: z.object({
        resource: z.enum([
            "email", "calendar", "automation", "preferences", "approval", "drive", "task"
        ]),
        ids: z.array(z.string()).max(50).optional(),
        changes: z.record(z.string(), z.any()),
    }),

    execute: async ({ resource, ids, changes }, { emailAccountId, logger, providers, userId }) => {
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
                const choiceIndex = typeof changes.choiceIndex === "number" ? changes.choiceIndex : undefined;
                const decision = changes.decision as "APPROVE" | "DENY" | undefined;
                const reason = changes.reason as string | undefined;

                const emailAccountApp = await getEmailAccountWithAi({ emailAccountId });
                if (!emailAccountApp) return { success: false, error: "User not found" };

                if (choiceIndex !== undefined) {
                    const requestRecord = await prisma.approvalRequest.findUnique({
                        where: { id: ids[0] },
                    });
                    const payload = requestRecord?.requestPayload as { actionType?: string } | null;
                    if (payload?.actionType === "schedule_proposal") {
                        const { resolveScheduleProposalRequestById } = await import("@/features/calendar/schedule-proposal");
                        const result = await resolveScheduleProposalRequestById({
                            requestId: ids[0],
                            choiceIndex,
                            userId: emailAccountApp.userId,
                        });
                        if (!result.ok) return { success: false, error: result.error };
                        return { success: true, data: result.data };
                    }
                }

                if (!decision) return { success: false, error: "Decision (APPROVE/DENY) or choiceIndex required" };

                if (decision === "APPROVE") {
                    const { executeApprovalRequest } = await import("@/features/approvals/execute");
                    const results = await Promise.all(
                        ids.map(async (id: string) => {
                            const execution = await executeApprovalRequest({
                                approvalRequestId: id,
                                decidedByUserId: emailAccountApp.userId,
                                reason,
                            });
                            return {
                                decision: "APPROVE" as const,
                                approvalRequestId: id,
                                execution,
                            };
                        }),
                    );
                    return { success: true, data: results };
                }

                const approvalResults = await Promise.all(ids.map((id: string) =>
                    approvalService.decideRequest({
                        approvalRequestId: id,
                        decidedByUserId: emailAccountApp.userId,
                        decision: "DENY",
                        reason
                    })
                ));

                return { success: true, data: approvalResults };

            case "task": {
                if (changes.scheduleNow === true) {
                    const scheduled = await scheduleTasksForUser({
                        userId,
                        emailAccountId,
                        source: "ai",
                    });
                    return { success: true, data: scheduled };
                }

                if (!ids || ids.length === 0) {
                    return { success: false, error: "No Task IDs provided" };
                }

                const updateData: any = {
                    title: typeof changes.title === "string" ? changes.title : undefined,
                    description: typeof changes.description === "string" ? changes.description : undefined,
                    durationMinutes: typeof changes.durationMinutes === "number" ? changes.durationMinutes : undefined,
                    status: typeof changes.status === "string" ? changes.status : undefined,
                    priority: typeof changes.priority === "string" ? changes.priority : undefined,
                    energyLevel: typeof changes.energyLevel === "string" ? changes.energyLevel : undefined,
                    preferredTime: typeof changes.preferredTime === "string" ? changes.preferredTime : undefined,
                    dueDate: typeof changes.dueDate === "string" ? new Date(changes.dueDate) : undefined,
                    startDate: typeof changes.startDate === "string" ? new Date(changes.startDate) : undefined,
                    isAutoScheduled: typeof changes.isAutoScheduled === "boolean" ? changes.isAutoScheduled : undefined,
                    scheduleLocked: typeof changes.scheduleLocked === "boolean" ? changes.scheduleLocked : undefined,
                    reschedulePolicy: typeof changes.reschedulePolicy === "string" ? changes.reschedulePolicy : undefined,
                    scheduledStart: typeof changes.scheduledStart === "string" ? new Date(changes.scheduledStart) : undefined,
                    scheduledEnd: typeof changes.scheduledEnd === "string" ? new Date(changes.scheduledEnd) : undefined,
                };

                const updated = await Promise.all(ids.map((id: string) =>
                    prisma.task.update({
                        where: { id },
                        data: updateData
                    })
                ));

                return { success: true, data: updated };
            }

            case "calendar":
                if (!ids || ids.length === 0) return { success: false, error: "No IDs provided" };
                if (!providers.calendar) {
                    return { success: false, error: "Calendar provider not available" };
                }

                const calendarId = typeof changes.calendarId === "string" ? changes.calendarId : undefined;
                const mode = changes.mode === "single" || changes.mode === "series" ? changes.mode : undefined;
                const start = typeof changes.start === "string" ? new Date(changes.start) : undefined;
                const end = typeof changes.end === "string" ? new Date(changes.end) : undefined;
                const timeZoneInput = typeof changes.timeZone === "string" ? changes.timeZone : undefined;
                const timeZoneResult = resolveTimeZoneOrUtc(timeZoneInput);
                const ambiguityResolved = changes.ambiguityResolved === true;

                if (timeZoneInput && timeZoneResult.isFallback) {
                    logger.warn("Invalid time zone for calendar update; falling back to UTC", {
                        originalTimeZone: timeZoneInput
                    });
                }

                if (!ambiguityResolved && timeZoneInput && start && isAmbiguousLocalTime(start, timeZoneResult.timeZone)) {
                    const durationMs = end ? end.getTime() - start.getTime() : undefined;
                    const earlierStartUtc = (await import("date-fns-tz")).fromZonedTime(start, timeZoneResult.timeZone);
                    const laterStartUtc = new Date(earlierStartUtc.getTime() + 60 * 60 * 1000);
                    const earlierEndUtc = durationMs ? new Date(earlierStartUtc.getTime() + durationMs) : undefined;
                    const laterEndUtc = durationMs ? new Date(laterStartUtc.getTime() + durationMs) : undefined;

                    const idempotencyKey = createHash("sha256")
                        .update(`ambiguous-modify:${userId}:${start.toISOString()}:${end?.toISOString()}:${timeZoneResult.timeZone}`)
                        .digest("hex");

                    const request = await approvalService.createRequest({
                        userId,
                        provider: "system",
                        externalContext: { source: "ambiguous_time" },
                        requestPayload: {
                            actionType: "ambiguous_time",
                            tool: "modify",
                            args: { resource, ids, changes },
                            options: {
                                earlier: {
                                    start: earlierStartUtc.toISOString(),
                                    end: earlierEndUtc?.toISOString()
                                },
                                later: {
                                    start: laterStartUtc.toISOString(),
                                    end: laterEndUtc?.toISOString()
                                },
                                timeZone: timeZoneResult.timeZone
                            },
                            message: "That time happens twice because of daylight saving. Which one did you mean?"
                        },
                        idempotencyKey,
                        expiresInSeconds: 3600
                    } as any);

                    return {
                        success: true,
                        data: { status: "ambiguous_time" },
                        interactive: {
                            type: "ambiguous_time" as const,
                            ambiguousRequestId: request.id,
                            summary: "That time happens twice because of daylight saving. Which one did you mean?",
                            actions: [
                                { label: "Earlier", style: "primary" as const, value: "earlier" },
                                { label: "Later", style: "primary" as const, value: "later" }
                            ]
                        }
                    };
                }

                if (!ambiguityResolved && timeZoneInput && end && isAmbiguousLocalTime(end, timeZoneResult.timeZone)) {
                    const earlierEndUtc = (await import("date-fns-tz")).fromZonedTime(end, timeZoneResult.timeZone);
                    const laterEndUtc = new Date(earlierEndUtc.getTime() + 60 * 60 * 1000);

                    const idempotencyKey = createHash("sha256")
                        .update(`ambiguous-modify-end:${userId}:${start?.toISOString()}:${end.toISOString()}:${timeZoneResult.timeZone}`)
                        .digest("hex");

                    const request = await approvalService.createRequest({
                        userId,
                        provider: "system",
                        externalContext: { source: "ambiguous_time" },
                        requestPayload: {
                            actionType: "ambiguous_time",
                            tool: "modify",
                            args: { resource, ids, changes },
                            options: {
                                earlier: {
                                    start: start?.toISOString(),
                                    end: earlierEndUtc.toISOString()
                                },
                                later: {
                                    start: start?.toISOString(),
                                    end: laterEndUtc.toISOString()
                                },
                                timeZone: timeZoneResult.timeZone
                            },
                            message: "That time happens twice because of daylight saving. Which one did you mean?"
                        },
                        idempotencyKey,
                        expiresInSeconds: 3600
                    } as any);

                    return {
                        success: true,
                        data: { status: "ambiguous_time" },
                        interactive: {
                            type: "ambiguous_time" as const,
                            ambiguousRequestId: request.id,
                            summary: "That time happens twice because of daylight saving. Which one did you mean?",
                            actions: [
                                { label: "Earlier", style: "primary" as const, value: "earlier" },
                                { label: "Later", style: "primary" as const, value: "later" }
                            ]
                        }
                    };
                }

                const results = await Promise.all(ids.map((id: string) =>
                    providers.calendar.updateEvent({
                        calendarId,
                        eventId: id,
                        input: {
                            title: typeof changes.title === "string" ? changes.title : undefined,
                            description: typeof changes.description === "string" ? changes.description : undefined,
                            location: typeof changes.location === "string" ? changes.location : undefined,
                            start,
                            end,
                            allDay: typeof changes.allDay === "boolean" ? changes.allDay : undefined,
                            isRecurring: typeof changes.isRecurring === "boolean" ? changes.isRecurring : undefined,
                            recurrenceRule: typeof changes.recurrenceRule === "string" ? changes.recurrenceRule : undefined,
                            timeZone: timeZoneInput ? timeZoneResult.timeZone : undefined,
                            mode
                        }
                    })
                ));

                await scheduleTasksForUser({ userId, emailAccountId, source: "ai" });
                return { success: true, data: results };

            case "automation": {
                if (!ids || ids.length === 0) return { success: false, error: "No Rule ID provided" };
                const ruleId = ids[0]!;

                if ("enabled" in changes) {
                    await prisma.rule.update({
                        where: { id: ruleId, emailAccountId },
                        data: { enabled: Boolean(changes.enabled) },
                    });
                    return {
                        success: true,
                        message: `Rule ${changes.enabled ? "enabled" : "disabled"}.`,
                    };
                }

                if ("instructions" in changes && typeof changes.instructions === "string") {
                    await prisma.rule.update({
                        where: { id: ruleId, emailAccountId },
                        data: { instructions: changes.instructions },
                    });
                    return { success: true, message: "Rule instructions updated." };
                }

                const automationResults = await Promise.all(ids.map((id: string) =>
                    providers.automation.updateRule(id, changes)
                ));
                return { success: true, data: automationResults };
            }

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

            case "preferences": {
                const accountId = emailAccountId;

                if ("digestEnabled" in changes && changes.digestEnabled !== undefined) {
                    const { applyToggleDigest } = await import("@/server/actions/settings");
                    await applyToggleDigest(accountId, {
                        enabled: Boolean(changes.digestEnabled),
                        timeOfDay:
                            changes.digestTime != null
                                ? new Date(changes.digestTime as string)
                                : undefined,
                    });
                    return {
                        success: true,
                        message: `Digest ${changes.digestEnabled ? "enabled" : "disabled"}.`,
                    };
                }

                if ("digestSchedule" in changes && changes.digestSchedule != null) {
                    const schedule = changes.digestSchedule as Record<string, unknown>;
                    const { applyDigestSchedule } = await import("@/server/actions/settings");
                    await applyDigestSchedule(accountId, {
                        intervalDays: (schedule.intervalDays as number) ?? null,
                        daysOfWeek: (schedule.daysOfWeek as number) ?? null,
                        timeOfDay:
                            schedule.timeOfDay != null
                                ? new Date(schedule.timeOfDay as string)
                                : null,
                        occurrences: (schedule.occurrences as number) ?? null,
                    });
                    return { success: true, message: "Digest schedule updated." };
                }

                if (
                    "statsEmailFrequency" in changes ||
                    "summaryEmailFrequency" in changes
                ) {
                    const emailAccount = await getEmailAccountWithAi({ emailAccountId: accountId });
                    if (!emailAccount)
                        return { success: false, error: "Email account not found" };
                    const { applyEmailSettings } = await import("@/server/actions/settings");
                    await applyEmailSettings(accountId, {
                        statsEmailFrequency:
                            (changes.statsEmailFrequency as string) ??
                            emailAccount.statsEmailFrequency ??
                            "NEVER",
                        summaryEmailFrequency:
                            (changes.summaryEmailFrequency as string) ??
                            emailAccount.summaryEmailFrequency ??
                            "NEVER",
                    });
                return {
                    success: true,
                    message: "Email notification settings updated.",
                };
                }

                if ("approvalPolicy" in changes && changes.approvalPolicy != null) {
                    const policyPayload = changes.approvalPolicy as {
                        toolName: string;
                        policy: string;
                        conditions?: Record<string, unknown>;
                    };
                    const { toolName: prefToolName, policy, conditions } = policyPayload;
                    await prisma.approvalPreference.upsert({
                        where: { userId_toolName: { userId, toolName: prefToolName } },
                        update: { policy, conditions: conditions ?? undefined },
                        create: {
                            userId,
                            toolName: prefToolName,
                            policy,
                            conditions: conditions ?? undefined,
                        },
                    });
                    return {
                        success: true,
                        message: `Approval policy for "${prefToolName}" set to "${policy}".`,
                    };
                }

                if ("aiConfig" in changes && changes.aiConfig != null) {
                    const config = changes.aiConfig as Record<string, unknown>;
                    const data = {
                        ...(config.maxSteps !== undefined && { maxSteps: Number(config.maxSteps) }),
                        ...(config.customInstructions !== undefined && { customInstructions: String(config.customInstructions) }),
                        ...(config.approvalInstructions !== undefined && { approvalInstructions: String(config.approvalInstructions) }),
                        ...(config.conversationCategories !== undefined && {
                            conversationCategories: Array.isArray(config.conversationCategories)
                                ? (config.conversationCategories as unknown[]).map(String)
                                : [],
                        }),
                        ...(config.defaultApprovalExpirySeconds !== undefined && {
                            defaultApprovalExpirySeconds: Number(config.defaultApprovalExpirySeconds),
                        }),
                    };
                    await prisma.userAIConfig.upsert({
                        where: { userId },
                        update: data,
                        create: { userId, ...data },
                    });
                    return { success: true, message: "AI configuration updated." };
                }

                return {
                    success: false,
                    error:
                        "Unknown preference key. Supported: digestEnabled, digestSchedule, statsEmailFrequency, summaryEmailFrequency, approvalPolicy, aiConfig.",
                };
            }

            case "marketing":
            case "notification":
            case "knowledge":
                return { success: false, error: "Modifying this resource not supported yet" };

            default:
                return { success: false, error: `Resource ${resource} not supported` };
        }
    },

    securityLevel: "CAUTION",
};
