/**
 * AI Tool: modify
 *
 * Wraps server actions / equivalents:
 * - email: archiveThreadAction, trashThreadAction, markReadThreadAction (via provider)
 * - automation: updateRuleAction, toggleRuleAction (enabled, instructions)
 * - preferences: centralized preference service mutations
 * - approval: ApprovalService.decideRequest, resolveScheduleProposalRequestById
 */

import { z } from "zod";
import { type ToolDefinition } from "./types";
import { ApprovalService } from "@/features/approvals/service";
import prisma from "@/server/db/client";
import { createEmailProvider } from "@/features/email/provider";
import { updateThreadTrackers } from "@/features/reply-tracker/handle-conversation-status";
import { getEmailAccountWithAi } from "@/server/lib/user/get";
import { internalDateToDate } from "@/server/lib/date";
import { scheduleTasksForUser } from "@/features/calendar/scheduling/TaskSchedulingService";
import { isAmbiguousLocalTime } from "@/features/calendar/scheduling/date-utils";
import { createHash } from "crypto";
import { updateDraftById } from "@/features/drafts/operations";
import {
    resolveCalendarTimeZoneForRequest,
    resolveDefaultCalendarTimeZone,
} from "./calendar-time";
import {
    parseDateBoundInTimeZone,
    parseLocalDateTimeInput,
} from "./timezone";
import {
    applyAiConfigPatch,
    applyDigestScheduleForEmailAccount,
    applyEmailNotificationSettings,
    applyTaskPreferencePatchForUser,
    toggleDigestForEmailAccount,
} from "@/features/preferences/service";

const approvalService = new ApprovalService(prisma);
type ApprovalCreateRequestInput = Parameters<ApprovalService["createRequest"]>[0];

const modifyIdsSchema = z.array(z.string()).max(50);
const modifyChangesSchema = z.record(z.string(), z.any());
const modifyEmailFilterSchema = z
    .object({
        query: z.string().optional(),
        subjectContains: z.string().optional(),
        bodyContains: z.string().optional(),
        text: z.string().optional(),
        from: z.string().optional(),
        to: z.string().optional(),
        dateRange: z
            .object({
                after: z.string().optional(),
                before: z.string().optional(),
            })
            .strict()
            .optional(),
        limit: z.number().int().min(1).max(200).optional(),
        pageToken: z.string().optional(),
        fetchAll: z.boolean().optional(),
        subscriptionsOnly: z.boolean().optional(),
    })
    .strict();

type ModifyEmailFilter = z.infer<typeof modifyEmailFilterSchema>;

function normalizeApprovalExecutionError(error: unknown): string {
    const message = error instanceof Error ? error.message : String(error);
    if (message.includes("Cannot decide on request in status: EXPIRED")) {
        return "Approval request expired. Ask me to recreate this action and request approval again.";
    }
    if (message.includes("Cannot decide on request in status: APPROVED")) {
        return "Approval request was already approved.";
    }
    if (message.includes("Cannot decide on request in status: DENIED")) {
        return "Approval request was already denied.";
    }
    return message;
}

function quoteQueryToken(value: string): string {
    const trimmed = value.trim();
    if (!trimmed) return "";
    if (/[\s"]/u.test(trimmed)) {
        return `"${trimmed.replace(/"/g, '\\"')}"`;
    }
    return trimmed;
}

function buildEmailSearchQueryFromFilter(filter: ModifyEmailFilter | undefined): string {
    if (!filter) return "";
    const terms: string[] = [];
    const isEmailLike = (value: string): boolean => value.includes("@");
    const push = (value: string | undefined) => {
        const trimmed = value?.trim();
        if (trimmed) terms.push(trimmed);
    };

    push(filter.query);
    if (filter.subjectContains) terms.push(`subject:${quoteQueryToken(filter.subjectContains)}`);
    if (filter.from && isEmailLike(filter.from)) terms.push(`from:${quoteQueryToken(filter.from)}`);
    if (filter.to && isEmailLike(filter.to)) terms.push(`to:${quoteQueryToken(filter.to)}`);
    if (filter.text) push(filter.text);
    if (filter.bodyContains) push(filter.bodyContains);

    return terms.join(" ").trim();
}

function parseDateBound(value: string | undefined): Date | undefined {
    if (!value) return undefined;
    const parsed = new Date(value);
    return Number.isNaN(parsed.getTime()) ? undefined : parsed;
}

const modifyParameters = z.discriminatedUnion("resource", [
    z.object({
        resource: z.literal("email"),
        ids: modifyIdsSchema.optional(),
        filter: modifyEmailFilterSchema.optional(),
        changes: modifyChangesSchema,
    })
        .strict()
        .superRefine((value, ctx) => {
            const unsubscribeRequested = value.changes?.unsubscribe === true;
            const hasIds = Array.isArray(value.ids) && value.ids.length > 0;
            if (!hasIds && !unsubscribeRequested) {
                ctx.addIssue({
                    code: z.ZodIssueCode.custom,
                    path: ["ids"],
                    message: "No IDs provided",
                });
            }
            if (unsubscribeRequested && !hasIds && !value.filter) {
                ctx.addIssue({
                    code: z.ZodIssueCode.custom,
                    path: ["filter"],
                    message: "filter is required for unsubscribe when ids are omitted",
                });
            }
        }),
    z.object({
        resource: z.literal("calendar"),
        ids: modifyIdsSchema,
        changes: modifyChangesSchema,
    }).strict(),
    z.object({
        resource: z.literal("automation"),
        ids: modifyIdsSchema,
        changes: modifyChangesSchema,
    }).strict(),
    z.object({
        resource: z.literal("preferences"),
        ids: modifyIdsSchema.optional(),
        changes: modifyChangesSchema,
    }).strict(),
    z.object({
        resource: z.literal("approval"),
        ids: modifyIdsSchema,
        changes: modifyChangesSchema,
    }).strict(),
    z.object({
        resource: z.literal("drive"),
        ids: modifyIdsSchema,
        changes: modifyChangesSchema,
    }).strict(),
    z.object({
        resource: z.literal("draft"),
        ids: modifyIdsSchema,
        changes: modifyChangesSchema,
    }).strict(),
    z.object({
        resource: z.literal("task"),
        ids: modifyIdsSchema.optional(),
        changes: modifyChangesSchema,
    }).strict(),
]);

export const modifyTool: ToolDefinition<typeof modifyParameters> = {
    name: "modify",
    description: `Modify existing items.

When to use:
- Use modify to update existing items by ID.
- Use create to make new items.
- Use delete to remove/cancel items.

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
- unsubscribe: true (unsubscribe senders for selected email IDs; if IDs are unknown, provide filter to resolve matching emails first)
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
- summaryEmailFrequency: "WEEKLY" | "NEVER"
- scheduling keys: workHourStart, workHourEnd, workDays, weekStartDay ("sunday" | "monday"), bufferMinutes, selectedCalendarIds, timeZone, groupByProject, defaultMeetingDurationMin, meetingSlotCount, meetingExpirySeconds
- aiConfig: { maxSteps, approvalInstructions, customInstructions, conversationCategories, defaultApprovalExpirySeconds }`,

    parameters: modifyParameters,

    execute: async ({ resource, ids, changes, ...rest }, { emailAccountId, logger, providers, userId }) => {
        switch (resource) {
            case "email":
                const filter = (rest as { filter?: ModifyEmailFilter }).filter;
                const normalizedIds = Array.isArray(ids)
                    ? ids.filter((id): id is string => typeof id === "string" && id.length > 0)
                    : [];

                // Handle Unsubscribe special case
                if (changes.unsubscribe) {
                    let targetIds = normalizedIds;
                    if (targetIds.length === 0) {
                        if (!filter) {
                            return {
                                success: false,
                                error: "No IDs provided. For unsubscribe without IDs, provide a filter.",
                            };
                        }

                        const searchResult = await providers.email.search({
                            query: buildEmailSearchQueryFromFilter(filter),
                            limit: filter.fetchAll ? undefined : (filter.limit ?? 100),
                            fetchAll: filter.fetchAll ?? false,
                            pageToken: filter.pageToken,
                            includeNonPrimary: Boolean(filter.subscriptionsOnly),
                            before: parseDateBound(filter.dateRange?.before),
                            after: parseDateBound(filter.dateRange?.after),
                            subjectContains: filter.subjectContains,
                            bodyContains: filter.bodyContains,
                            text: filter.text,
                            from: filter.from,
                            to: filter.to,
                        });

                        targetIds = searchResult.messages
                            .map((message) => message.id)
                            .filter((id): id is string => typeof id === "string" && id.length > 0);

                        if (targetIds.length === 0) {
                            return {
                                success: false,
                                error: "No matching emails found to unsubscribe from.",
                            };
                        }
                    }

                    const emails = await providers.email.get(targetIds);
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
                            targetIds,
                            details: results
                        }
                    };
                }

                if (normalizedIds.length === 0) return { success: false, error: "No IDs provided" };

                // Handle Reply Tracking
                if (changes.tracking === true || changes.tracking === false) {
                    const emailAccount = await getEmailAccountWithAi({ emailAccountId });
                    if (!emailAccount) return { success: false, error: "Email account not found" };

                    let setupCount = 0;
                    for (const id of normalizedIds) {
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
                    const emails = await providers.email.get(normalizedIds);
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
                    const emails = await providers.email.get(normalizedIds);
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
                    const emails = await providers.email.get(normalizedIds);
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
                    const emails = await providers.email.get(normalizedIds);
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
                    data: await providers.email.modify(normalizedIds, changes),
                };

            case "draft":
                if (!ids || ids.length === 0) return { success: false, error: "No Draft IDs provided" };
                await Promise.all(
                    ids.map((id: string) =>
                        updateDraftById(providers.email, id, {
                            subject: typeof changes.subject === "string" ? changes.subject : undefined,
                            messageHtml:
                                typeof changes.messageHtml === "string"
                                    ? changes.messageHtml
                                    : typeof changes.body === "string"
                                        ? changes.body
                                        : undefined,
                        }),
                    ),
                );
                return { success: true, data: { count: ids.length } };

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
                            try {
                                const execution = await executeApprovalRequest({
                                    approvalRequestId: id,
                                    decidedByUserId: emailAccountApp.userId,
                                    reason,
                                });
                                return {
                                    decision: "APPROVE" as const,
                                    approvalRequestId: id,
                                    success: true,
                                    execution,
                                };
                            } catch (error) {
                                return {
                                    decision: "APPROVE" as const,
                                    approvalRequestId: id,
                                    success: false,
                                    error: normalizeApprovalExecutionError(error),
                                };
                            }
                        }),
                    );
                    const failures = results.filter((result) => !result.success);
                    return {
                        success: failures.length === 0,
                        data: results,
                        error: failures.length > 0 ? failures[0].error : undefined,
                    };
                }

                const approvalResults = await Promise.all(
                    ids.map(async (id: string) => {
                        try {
                            const approval = await approvalService.decideRequest({
                                approvalRequestId: id,
                                decidedByUserId: emailAccountApp.userId,
                                decision: "DENY",
                                reason,
                            });
                            return { approvalRequestId: id, success: true, approval };
                        } catch (error) {
                            return {
                                approvalRequestId: id,
                                success: false,
                                error: normalizeApprovalExecutionError(error),
                            };
                        }
                    }),
                );

                const failures = approvalResults.filter((result) => !result.success);
                return {
                    success: failures.length === 0,
                    data: approvalResults,
                    error: failures.length > 0 ? failures[0].error : undefined,
                };

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

                const updateData = {
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

                const updateResult = await prisma.task.updateMany({
                    where: { id: { in: ids }, userId },
                    data: updateData
                });

                if (updateResult.count === 0) {
                    return { success: false, error: "No matching tasks found for this user" };
                }

                const updated = await prisma.task.findMany({
                    where: { id: { in: ids }, userId },
                    orderBy: { updatedAt: "desc" }
                });

                return { success: true, data: updated };
            }

            case "calendar":
                if (!ids || ids.length === 0) return { success: false, error: "No IDs provided" };
                if (!providers.calendar) {
                    return { success: false, error: "Calendar provider not available" };
                }

                const calendarId = typeof changes.calendarId === "string" ? changes.calendarId : undefined;
                const mode = changes.mode === "single" || changes.mode === "series" ? changes.mode : undefined;
                const timeZoneInput = typeof changes.timeZone === "string" ? changes.timeZone : undefined;
                const defaultCalendarTimeZone = await resolveDefaultCalendarTimeZone({
                    userId,
                    emailAccountId,
                });
                if ("error" in defaultCalendarTimeZone) {
                    return { success: false, error: defaultCalendarTimeZone.error };
                }
                const effectiveTimeZoneResolution = resolveCalendarTimeZoneForRequest({
                    requestedTimeZone: timeZoneInput,
                    defaultTimeZone: defaultCalendarTimeZone.timeZone,
                });
                if ("error" in effectiveTimeZoneResolution) {
                    return { success: false, error: effectiveTimeZoneResolution.error };
                }
                const effectiveTimeZone = effectiveTimeZoneResolution.timeZone;
                const start =
                    typeof changes.start === "string"
                        ? parseDateBoundInTimeZone(changes.start, effectiveTimeZone, "start") ?? undefined
                        : undefined;
                const end =
                    typeof changes.end === "string"
                        ? parseDateBoundInTimeZone(changes.end, effectiveTimeZone, "end") ?? undefined
                        : undefined;
                const ambiguityResolved = changes.ambiguityResolved === true;

                if (changes.isRecurring === true && typeof changes.recurrenceRule !== "string") {
                    return { success: false, error: "recurrenceRule is required when isRecurring is true" };
                }

                if (typeof changes.start === "string" && !start) {
                    return { success: false, error: "Invalid calendar start. Use ISO date/time format." };
                }
                if (typeof changes.end === "string" && !end) {
                    return { success: false, error: "Invalid calendar end. Use ISO date/time format." };
                }
                if (start && end && start.getTime() >= end.getTime()) {
                    return { success: false, error: "Calendar end time must be after start time." };
                }

                const localStartInput = parseLocalDateTimeInput(typeof changes.start === "string" ? changes.start : undefined);
                if (!ambiguityResolved && localStartInput && isAmbiguousLocalTime(localStartInput, effectiveTimeZone)) {
                    const durationMs = start && end ? end.getTime() - start.getTime() : undefined;
                    const earlierStartUtc = (await import("date-fns-tz")).fromZonedTime(localStartInput, effectiveTimeZone);
                    const laterStartUtc = new Date(earlierStartUtc.getTime() + 60 * 60 * 1000);
                    const earlierEndUtc = durationMs ? new Date(earlierStartUtc.getTime() + durationMs) : undefined;
                    const laterEndUtc = durationMs ? new Date(laterStartUtc.getTime() + durationMs) : undefined;

                    const idempotencyKey = createHash("sha256")
                        .update(`ambiguous-modify:${userId}:${start?.toISOString()}:${end?.toISOString()}:${effectiveTimeZone}`)
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
                                timeZone: effectiveTimeZone
                            },
                            message: "That time happens twice because of daylight saving. Which one did you mean?"
                        },
                        idempotencyKey,
                        expiresInSeconds: 3600
                    } as ApprovalCreateRequestInput);

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

                const localEndInput = parseLocalDateTimeInput(typeof changes.end === "string" ? changes.end : undefined);
                if (!ambiguityResolved && localEndInput && isAmbiguousLocalTime(localEndInput, effectiveTimeZone)) {
                    const earlierEndUtc = (await import("date-fns-tz")).fromZonedTime(localEndInput, effectiveTimeZone);
                    const laterEndUtc = new Date(earlierEndUtc.getTime() + 60 * 60 * 1000);

                    const idempotencyKey = createHash("sha256")
                        .update(`ambiguous-modify-end:${userId}:${start?.toISOString()}:${end?.toISOString()}:${effectiveTimeZone}`)
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
                                timeZone: effectiveTimeZone
                            },
                            message: "That time happens twice because of daylight saving. Which one did you mean?"
                        },
                        idempotencyKey,
                        expiresInSeconds: 3600
                    } as ApprovalCreateRequestInput);

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
                            timeZone: timeZoneInput || start || end ? effectiveTimeZone : undefined,
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
                    await toggleDigestForEmailAccount({
                        emailAccountId: accountId,
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
                    await applyDigestScheduleForEmailAccount({
                        emailAccountId: accountId,
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
                    await applyEmailNotificationSettings({
                        emailAccountId: accountId,
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

                const schedulingPreferenceKeys = [
                    "workHourStart",
                    "workHourEnd",
                    "workDays",
                    "weekStartDay",
                    "bufferMinutes",
                    "selectedCalendarIds",
                    "timeZone",
                    "groupByProject",
                    "defaultMeetingDurationMin",
                    "meetingSlotCount",
                    "meetingExpirySeconds",
                ] as const;

                if (schedulingPreferenceKeys.some((key) => key in changes)) {
                    await applyTaskPreferencePatchForUser({
                        userId,
                        patch: {
                            workHourStart:
                                typeof changes.workHourStart === "number"
                                    ? changes.workHourStart
                                    : undefined,
                            workHourEnd:
                                typeof changes.workHourEnd === "number"
                                    ? changes.workHourEnd
                                    : undefined,
                            workDays: Array.isArray(changes.workDays)
                                ? (changes.workDays as number[])
                                : undefined,
                            weekStartDay:
                                changes.weekStartDay === "sunday" ||
                                changes.weekStartDay === "monday"
                                    ? changes.weekStartDay
                                    : undefined,
                            bufferMinutes:
                                typeof changes.bufferMinutes === "number"
                                    ? changes.bufferMinutes
                                    : undefined,
                            selectedCalendarIds: Array.isArray(changes.selectedCalendarIds)
                                ? (changes.selectedCalendarIds as string[])
                                : undefined,
                            timeZone:
                                typeof changes.timeZone === "string"
                                    ? changes.timeZone
                                    : undefined,
                            groupByProject:
                                typeof changes.groupByProject === "boolean"
                                    ? changes.groupByProject
                                    : undefined,
                            defaultMeetingDurationMin:
                                typeof changes.defaultMeetingDurationMin === "number"
                                    ? changes.defaultMeetingDurationMin
                                    : undefined,
                            meetingSlotCount:
                                typeof changes.meetingSlotCount === "number"
                                    ? changes.meetingSlotCount
                                    : undefined,
                            meetingExpirySeconds:
                                typeof changes.meetingExpirySeconds === "number"
                                    ? changes.meetingExpirySeconds
                                    : undefined,
                        },
                    });
                    return {
                        success: true,
                        message: "Scheduling preferences updated.",
                    };
                }

                if ("aiConfig" in changes && changes.aiConfig != null) {
                    const config = changes.aiConfig as Record<string, unknown>;
                    await applyAiConfigPatch({
                        userId,
                        patch: {
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
                        },
                    });
                    return { success: true, message: "AI configuration updated." };
                }

                return {
                    success: false,
                    error:
                        "Unknown preference key. Supported: digestEnabled, digestSchedule, statsEmailFrequency, summaryEmailFrequency, aiConfig, and scheduling keys.",
                };
            }

            default:
                return { success: false, error: `Resource ${resource} not supported` };
        }
    },

    securityLevel: "CAUTION",
};
