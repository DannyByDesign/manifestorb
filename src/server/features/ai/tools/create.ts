/**
 * AI Tool: create
 *
 * Wraps server actions / equivalents:
 * - automation: createRule (provider), createGroupAction (when createGroup + ruleId)
 * - knowledge: providers.automation.createKnowledge
 * - email: draft creation; send via send tool
 */

import { z } from "zod";
import { env } from "@/env";
import { type ToolDefinition } from "./types";
import { isGoogleProvider } from "@/features/email/provider-types";
import prisma from "@/server/db/client";
import { getEmailAccountWithAi } from "@/server/lib/user/get";
import { processAttachment } from "@/features/drive/filing-engine";
import { generateNotification, type NotificationType } from "@/features/notifications/generator";
import { aiCollectReplyContext } from "@/features/reply-tracker/ai/reply-context-collector";
import { createScopedLogger } from "@/server/lib/logger";
import { scheduleTasksForUser, resolveSchedulingEmailAccountId } from "@/features/calendar/scheduling/TaskSchedulingService";
import { addDays, isAmbiguousLocalTime, resolveTimeZoneOrUtc } from "@/features/calendar/scheduling/date-utils";
import { CalendarServiceImpl } from "@/features/calendar/scheduling/CalendarServiceImpl";
import { TimeSlotManagerImpl } from "@/features/calendar/scheduling/TimeSlotManager";
import { ApprovalService } from "@/features/approvals/service";
import { requiresApproval } from "@/features/approvals/policy";
import { findCrossReferences } from "@/features/ai/cross-reference";
import { createDeterministicIdempotencyKey } from "@/server/lib/idempotency";
import { createDraft as createDraftOperation } from "@/features/drafts/operations";
import {
    resolveDefaultCalendarTimeZone,
    resolveCalendarTimeZoneForRequest,
} from "./calendar-time";
import {
    parseDateBoundInTimeZone,
    parseLocalDateTimeInput,
} from "./timezone";
import { validateCalendarMutationSafety } from "@/features/calendar/safety-gate";
import { upsertCalendarEventShadow } from "@/features/calendar/canonical-state";
import {
    resolveCalendarAttendees,
    resolveContextualAttendees,
} from "@/features/calendar/participant-resolver";

const logger = createScopedLogger("tools/create");
const approvalService = new ApprovalService(prisma);

const formatSlotLabel = (start: Date, end: Date | null | undefined, timeZone: string) => {
    const formatter = new Intl.DateTimeFormat("en-US", {
        weekday: "short",
        month: "short",
        day: "numeric",
        hour: "numeric",
        minute: "2-digit",
        hour12: true,
        timeZone
    });
    const startLabel = formatter.format(start);
    if (!end) {
        return startLabel;
    }
    const endLabel = formatter.format(end);
    return `${startLabel} - ${endLabel}`;
};

function isPlaceholderDraftBody(body: string | undefined): boolean {
    if (!body) return true;
    const normalized = body.trim().toLowerCase();
    if (normalized.length === 0) return true;
    const placeholderPatterns = [
        /^this is (a|an) (generic|test) email\b/u,
        /please review (and|&) add your content/u,
        /^this is an email drafted for/u,
        /^draft email\b/u,
        /insert .* here/u,
    ];
    return placeholderPatterns.some((pattern) => pattern.test(normalized));
}

const emailCreateDataSchema = z.object({
    // Back-compat: some model outputs incorrectly place draft type under data.
    // We accept and normalize this to avoid runtime failures.
    type: z.enum(["new", "reply", "forward"]).optional(),
    to: z.array(z.string()).optional(),
    cc: z.array(z.string()).optional(),
    bcc: z.array(z.string()).optional(),
    subject: z.string().optional(),
    body: z.string().optional(),
    sendOnApproval: z.boolean().optional().describe("If true, creates a draft and immediately requests approval to send it. Set true only when the user explicitly asks to send now (or send right after approval). For normal draft/compose requests, leave false."),
}).strict();

const calendarCreateDataSchema = z.object({
    title: z.string().optional().describe("Event title inferred from user request."),
    description: z.string().optional(),
    start: z.string().optional().describe("ISO 8601 start time. Omit when using autoSchedule."),
    end: z.string().optional().describe("ISO 8601 end time. Omit when using autoSchedule."),
    durationMinutes: z.number().min(5).max(480).optional().describe("Meeting duration in minutes. Defaults to 30 if omitted."),
    autoSchedule: z.boolean().optional().describe("Set true to find 3 available calendar slots automatically."),
    calendarId: z.string().optional(),
    allDay: z.boolean().optional(),
    isRecurring: z.boolean().optional(),
    recurrenceRule: z.string().optional(),
    timeZone: z.string().optional(),
    attendees: z.array(z.string()).optional(),
    location: z.string().optional(),
    ambiguityResolved: z.boolean().optional(),
}).strict();

const taskCreateDataSchema = z.object({
    title: z.string().optional().describe("Task title."),
    description: z.string().optional(),
    durationMinutes: z.number().min(5).max(480).optional(),
    reschedulePolicy: z.enum(["FIXED", "FLEXIBLE", "APPROVAL_REQUIRED"]).optional(),
    status: z.enum(["PENDING", "IN_PROGRESS", "COMPLETED", "CANCELLED"]).optional(),
    priority: z.enum(["NONE", "LOW", "MEDIUM", "HIGH"]).optional(),
    energyLevel: z.enum(["LOW", "MEDIUM", "HIGH"]).optional(),
    preferredTime: z.enum(["MORNING", "AFTERNOON", "EVENING"]).optional(),
    dueDate: z.string().optional(),
    startDate: z.string().optional(),
    isAutoScheduled: z.boolean().optional(),
    scheduleLocked: z.boolean().optional(),
    scheduledStart: z.string().optional(),
    scheduledEnd: z.string().optional(),
}).strict();

const automationCreateDataSchema = z.object({
    name: z.string().optional(),
    conditions: z.unknown().optional(),
    actions: z.array(z.unknown()).optional(),
    ruleId: z.string().optional().describe("Rule ID when creating a group for learned patterns"),
    createGroup: z.boolean().optional().describe("Set true to create a learned-patterns group for the given ruleId"),
}).strict();

const knowledgeCreateDataSchema = z.object({
    title: z.string().optional(),
    content: z.string().optional(),
}).strict();

const driveCreateDataSchema = z.object({
    name: z.string().optional(),
    messageId: z.string().optional(),
    attachmentId: z.string().optional(),
}).strict();

const notificationCreateDataSchema = z.object({
    title: z.string().optional(),
    type: z.enum(["email", "calendar", "system", "task"]).optional(),
    source: z.string().optional(),
    detail: z.string().optional(),
}).strict();

const contactsCreateDataSchema = z.object({
    name: z.string().optional(),
    to: z.array(z.string()).optional(),
    phone: z.string().optional(),
    company: z.string().optional(),
    jobTitle: z.string().optional(),
}).strict();

const categoryCreateDataSchema = z.object({
    name: z.string().optional(),
    categoryName: z.string().optional(),
    description: z.string().optional(),
    isLearned: z.boolean().optional(),
}).strict();

const createParameters = z.discriminatedUnion("resource", [
    z.object({
        resource: z.literal("email"),
        type: z.enum(["new", "reply", "forward"]).optional(),
        parentId: z.string().optional(),
        data: emailCreateDataSchema,
    }).strict(),
    z.object({
        resource: z.literal("calendar"),
        data: calendarCreateDataSchema,
    }).strict(),
    z.object({
        resource: z.literal("task"),
        data: taskCreateDataSchema,
    }).strict(),
    z.object({
        resource: z.literal("automation"),
        data: automationCreateDataSchema,
    }).strict(),
    z.object({
        resource: z.literal("knowledge"),
        data: knowledgeCreateDataSchema,
    }).strict(),
    z.object({
        resource: z.literal("drive"),
        parentId: z.string().optional(),
        data: driveCreateDataSchema,
    }).strict(),
    z.object({
        resource: z.literal("notification"),
        data: notificationCreateDataSchema,
    }).strict(),
    z.object({
        resource: z.literal("contacts"),
        data: contactsCreateDataSchema,
    }).strict(),
    z.object({
        resource: z.literal("category"),
        data: categoryCreateDataSchema,
    }).strict(),
]);

export const createTool: ToolDefinition<typeof createParameters> = {
    name: "create",
    description: `Create new items.

When to use:
- Use create for new drafts/events/tasks/rules/records.
- Use modify to change existing records.
- Use delete to remove/cancel existing records.

Email: Creates a DRAFT only. User must manually send from UI.
- type: "new" | "reply" | "forward"
- For reply/forward: provide parentId (thread ID / message ID)
- If message intent/body is missing for a new draft, ask one concise clarification instead of inventing placeholder text.
- Returns: { draftId, previewUrl } for user to review and send

Calendar (scheduling): When the user wants to schedule a meeting, call, or appointment (any intent to find time):
- Set resource="calendar", data.autoSchedule=true. Use data.title from the message if given, otherwise use a generic title like "Meeting". data.durationMinutes defaults to 30; data.timeZone if known.
- Resolve attendees from user context before creating/scheduling when possible. If the user uses pronouns ("them", "this person"), infer participants from thread/conversation context and pass data.attendees when confidence is high.
- If participant intent exists but attendees are unresolved or ambiguous, ask one concise clarification before creating the event.
- If the user has a pending schedule proposal (see Pending State), interpret their reply (e.g. "the first one", "Tuesday") and resolve via the approval flow.
- For a specific time: set data.start and data.end (ISO strings) instead of autoSchedule.

Task: Creates a task and optionally auto-schedules it. If flexibility is not specified by the user, choose a reschedulePolicy.

	Automation: Create Rules & Knowledge supported.
	Category: Creates or resolves a category by name.`,

    parameters: createParameters,



    execute: async ({ resource, type, parentId, data }, context) => {
        const { emailAccountId, providers } = context;
        switch (resource) {
            case "email":
                let replyContext = null;
                const emailAccount = await getEmailAccountWithAi({ emailAccountId: context.emailAccountId });
                if (!emailAccount || !emailAccount.account?.provider) {
                    return { success: false, error: "Email account not found or provider not linked. The user needs to connect Gmail/Outlook." };
                }
                // Validate recipients for new emails
                const draftType =
                    (type as "new" | "reply" | "forward" | undefined) ||
                    (data.type as "new" | "reply" | "forward" | undefined) ||
                    "new";
                if (draftType === "new" && (!data.to || data.to.length === 0)) {
                    return {
                        success: false,
                        error: "Cannot create a new email draft without recipients. Provide at least one email address in data.to. If the user mentioned a name, search for their email with query(resource: 'contacts', filter: { query: 'name' }) first."
                    };
                }
                if (draftType === "new" && isPlaceholderDraftBody(data.body)) {
                    return {
                        success: false,
                        error: "Missing email message intent/body content.",
                        clarification: {
                            kind: "missing_fields",
                            prompt: "Absolutely. What should the email say?",
                            missingFields: ["data.body"],
                        },
                    };
                }
                const isReply = draftType === "reply";

                if (isReply && parentId && providers.email) {
                    try {
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
                const draftResult = await createDraftOperation(providers.email, {
                    type: draftType,
                    parentId,
                    to: data.to,
                    cc: data.cc,
                    bcc: data.bcc,
                    subject: data.subject,
                    body: data.body
                });

                const draftId = (draftResult as { draftId?: string; id?: string }).draftId ?? (draftResult as { id?: string }).id;
                logger.info("[create/email] draft created", {
                    userId: context.userId,
                    draftId: draftId ?? null,
                    sendOnApproval: data.sendOnApproval === true,
                    recipientCount: data.to?.length ?? 0,
                    subject: data.subject ?? null,
                });
                if (data.sendOnApproval && draftId) {
                    const needsApproval = await requiresApproval({
                        userId: context.userId,
                        toolName: "send",
                        args: {
                            draftId,
                            resource: "email",
                            data: {
                                to: data.to,
                                cc: data.cc,
                                bcc: data.bcc,
                                subject: data.subject,
                            },
                        },
                    });
                    if (!needsApproval) {
                        const sendResult = await providers.email.sendDraft(draftId);
                        return {
                            success: true,
                            data: {
                                draftId,
                                status: "sent",
                                sendResult,
                            },
                            message: "Success",
                        };
                    }

                    const approvalService = new ApprovalService(prisma);
                    const idempotencyKey = createDeterministicIdempotencyKey(
                        "send-draft",
                        context.userId,
                        draftId,
                    );
                    const approval = await approvalService.createRequest({
                        userId: context.userId,
                        provider: "system",
                        externalContext: { source: "draft_and_send" },
                        requestPayload: {
                            actionType: "send_draft",
                            description: `Send email to ${data.to?.join(", ") ?? "recipients"} re: ${data.subject ?? "(No subject)"}`,
                            tool: "send",
                            args: { draftId },
                            draftId,
                            emailAccountId: context.emailAccountId,
                            recipients: data.to,
                            subject: data.subject,
                        },
                        idempotencyKey,
                        expiresInSeconds: 86_400,
                    });
                    const { createInAppNotification } = await import("@/features/notifications/create");
                    await createInAppNotification({
                        userId: context.userId,
                        title: `Draft ready: ${data.subject || "(No subject)"}`,
                        body: `To: ${data.to?.join(", ") ?? "—"}. Approve to send.`,
                        type: "approval",
                        metadata: {
                            approvalId: approval.id,
                            draftId,
                            to: data.to,
                            subject: data.subject,
                            bodyPreview: (data.body ?? "").substring(0, 300),
                        },
                        dedupeKey: `draft-send-${approval.id}`,
                    });
                    return {
                        success: true,
                        data: { draftId, approvalId: approval.id, status: "draft_pending_approval" },
                        message: "Draft created and ready for your approval. You'll see a notification to review and send.",
                        interactive: {
                            type: "approval_request" as const,
                            approvalId: approval.id,
                            summary: `Approve send for "${data.subject || "(No subject)"}"?`,
                            actions: [
                                { label: "Approve", style: "primary" as const, value: "approve" },
                                { label: "Deny", style: "danger" as const, value: "deny" },
                            ],
                        },
                    };
                }

                // Build summary for interactive UI
                const recipients = data.to?.join(", ") || "unknown";
                const subjectLine = data.subject || "(no subject)";

                const actions = [
                    { label: "Send", style: "primary" as const, value: "send" },
                ] as Array<{ label: string; style: "primary" | "danger"; value: string; url?: string }>;
                if (isGoogleProvider(emailAccount.account.provider)) {
                    const draftUrl = `https://mail.google.com/mail/u/0/#drafts/${draftId}`;
                    actions.push({ label: "Edit in Gmail", style: "primary" as const, value: "edit", url: draftUrl });
                }
                actions.push({ label: "Discard", style: "danger" as const, value: "discard" });

                return {
                    success: true,
                    data: {
                        ...draftResult,
                        replyContext
                    },
                    interactive: {
                        type: "draft_created" as const,
                        draftId,
                        emailAccountId: context.emailAccountId,
                        userId: context.userId,
                        summary: `Draft to ${recipients} - "${subjectLine}"`,
                        actions,
                        preview: {
                            to: data.to || [],
                            cc: data.cc,
                            bcc: data.bcc,
                            subject: data.subject || "",
                            body: data.body || ""
                        }
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

                if (!emailAccountFiling.filingEnabled || !emailAccountFiling.filingPrompt) {
                    return { success: false, error: "Smart filing is not enabled for this account" };
                }

                // Fetch Message to get Attachment Metadata
                // Provider.get returns ParsedMessage[]
                const fileMessages = await providers.email.get([data.messageId]);
                if (!fileMessages || fileMessages.length === 0) return { success: false, error: "Message not found" };
                const fileMsg = fileMessages[0];

                // Find Attachment
                const attachment = fileMsg.attachments?.find(
                    (item) => item.attachmentId === data.attachmentId
                );
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
                        filingEnabled: emailAccountFiling.filingEnabled,
                        filingPrompt: emailAccountFiling.filingPrompt,
                        email: emailAccountFiling.email,
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
                if (!providers.calendar) {
                    return { success: false, error: "Calendar provider not available" };
                }

                if (!data.autoSchedule && !data.start) {
                    return { success: false, error: "Calendar scheduling requires autoSchedule or a start time" };
                }

                if (!env.NEXT_PUBLIC_CALENDAR_SCHEDULING_ENABLED) {
                    return { success: false, error: "Calendar scheduling is disabled" };
                }

                if (!data.title) {
                    return { success: false, error: "Calendar title is required" };
                }

                if (data.isRecurring === true && !data.recurrenceRule) {
                    return { success: false, error: "recurrenceRule is required when isRecurring is true" };
                }

                if (!providers.email) {
                    return { success: false, error: "Email provider not available for attendee resolution" };
                }

                const ownerAccount = await prisma.emailAccount.findUnique({
                    where: { id: emailAccountId },
                    select: { email: true },
                });
                if (!ownerAccount?.email) {
                    return { success: false, error: "Unable to resolve your account email for attendee resolution." };
                }

                const contextualAttendees = await resolveContextualAttendees({
                    userId: context.userId,
                    emailAccountId,
                    conversationId: context.conversationId,
                    sourceEmailMessageId: context.emailMessageId,
                    sourceEmailThreadId: context.emailThreadId,
                    userEmail: ownerAccount.email,
                });

                const attendeeResolution = await resolveCalendarAttendees({
                    requestedAttendees: data.attendees,
                    title: data.title,
                    description: data.description,
                    currentMessage: context.currentMessage,
                    userEmail: ownerAccount.email,
                    contextualAttendees,
                    searchContacts: async (query) => providers.email.searchContacts(query),
                });

                if (attendeeResolution.participantIntent && attendeeResolution.confidence === "medium") {
                    const suggested = attendeeResolution.attendees;
                    const alternatives = attendeeResolution.candidateEmails;
                    const suggestedLabel = suggested.length > 0 ? suggested.join(", ") : "a likely attendee";
                    const alternativesLabel =
                        alternatives.length > 0 ? ` Alternatives: ${alternatives.join(", ")}.` : "";
                    const confirmationMessage =
                        attendeeResolution.reason === "explicit_context_conflict"
                            ? `I found a context mismatch. You asked with a pronoun, but the attendee appears to be ${suggestedLabel}.`
                            : `I found a likely attendee: ${suggestedLabel}.`;
                    return {
                        success: false,
                        error: `${confirmationMessage} Please confirm this attendee or provide a different name/email.${alternativesLabel}`,
                        clarification: {
                            kind: "missing_fields" as const,
                            prompt: `${confirmationMessage} Please confirm the attendee or share the right email.${alternativesLabel}`,
                            missingFields: ["attendees"],
                        },
                        data: {
                            needsClarification: true,
                            reason: "attendee_confirmation_required",
                            attendeeResolutionReason: attendeeResolution.reason,
                            suggestedAttendees: suggested,
                            alternatives,
                        },
                    };
                }

                if (attendeeResolution.participantIntent && attendeeResolution.attendees.length === 0) {
                    const candidateList =
                        attendeeResolution.candidateEmails.length > 0
                            ? ` Possible matches: ${attendeeResolution.candidateEmails.join(", ")}.`
                            : "";
                    const clarificationMessage =
                        attendeeResolution.reason === "broad_group_reference"
                            ? "I can't schedule a meeting with a broad group reference like \"the team\" without explicit attendees."
                            : attendeeResolution.reason === "contextual_group_reference"
                                ? "I found a likely group from context."
                            : attendeeResolution.reason === "missing_context_reference"
                                ? "I couldn't resolve who \"them\" refers to from context."
                                : attendeeResolution.reason === "ambiguous_context_reference" ||
                                    attendeeResolution.reason === "ambiguous_contact_match"
                                    ? "I found multiple possible attendees."
                                    : "I couldn't safely determine who should attend this meeting.";
                    return {
                        success: false,
                        error: `${clarificationMessage} Please provide attendee names or emails so I can invite them.${candidateList}`,
                        clarification: {
                            kind: "missing_fields" as const,
                            prompt: `${clarificationMessage} Please share attendee names or emails so I can invite them.${candidateList}`,
                            missingFields: ["attendees"],
                        },
                        data: {
                            needsClarification: true,
                            reason: "unresolved_attendees",
                            attendeeResolutionReason: attendeeResolution.reason,
                            candidates: attendeeResolution.candidateEmails,
                        },
                    };
                }

                const calendarData = {
                    ...data,
                    attendees: attendeeResolution.attendees,
                };

                const defaultCalendarTimeZone = await resolveDefaultCalendarTimeZone({
                    userId: context.userId,
                    emailAccountId,
                });
                if ("error" in defaultCalendarTimeZone) {
                    return { success: false, error: defaultCalendarTimeZone.error };
                }
                const effectiveTimeZoneResolution = resolveCalendarTimeZoneForRequest({
                    requestedTimeZone: calendarData.timeZone,
                    defaultTimeZone: defaultCalendarTimeZone.timeZone,
                });
                if ("error" in effectiveTimeZoneResolution) {
                    return { success: false, error: effectiveTimeZoneResolution.error };
                }
                const effectiveTimeZone = effectiveTimeZoneResolution.timeZone;

                const parsedStart =
                    typeof calendarData.start === "string"
                        ? parseDateBoundInTimeZone(calendarData.start, effectiveTimeZone, "start")
                        : null;
                const parsedEnd =
                    typeof calendarData.end === "string"
                        ? parseDateBoundInTimeZone(calendarData.end, effectiveTimeZone, "end")
                        : null;

                if (typeof calendarData.start === "string" && !parsedStart) {
                    return { success: false, error: "Invalid calendar start. Use ISO date/time format." };
                }
                if (typeof calendarData.end === "string" && !parsedEnd) {
                    return { success: false, error: "Invalid calendar end. Use ISO date/time format." };
                }
                if (parsedStart && parsedEnd && parsedStart.getTime() >= parsedEnd.getTime()) {
                    return { success: false, error: "Calendar end time must be after start time." };
                }

                if (calendarData.autoSchedule || !calendarData.start || !calendarData.end) {
                    const durationMinutes = calendarData.durationMinutes || 30;
                    const slots = await providers.calendar.findAvailableSlots({
                        durationMinutes,
                        start: parsedStart ?? undefined,
                        end: parsedEnd ?? undefined
                    });
                    const safeOptions: Array<{ start: string; end?: string; timeZone: string }> = [];
                    for (const slot of slots) {
                        const safety = await validateCalendarMutationSafety({
                            userId: context.userId,
                            emailAccountId,
                            mutation: "create",
                            providers: { calendar: providers.calendar },
                            proposedStart: slot.start,
                            proposedEnd: slot.end,
                        });
                        if (!safety.ok) continue;
                        safeOptions.push({
                            start: slot.start.toISOString(),
                            end: slot.end.toISOString(),
                            timeZone: effectiveTimeZone,
                        });
                        if (safeOptions.length >= 3) break;
                    }
                    const options = safeOptions;
                    if (options.length === 0) {
                        return {
                            success: false,
                            clarification: {
                                kind: "missing_fields",
                                prompt:
                                    "I couldn't find a safe slot in that range. I can try a wider window or a shorter duration. Which do you want?",
                                missingFields: ["time window or duration"],
                            },
                        };
                    }

                    const idempotencyKey = createDeterministicIdempotencyKey(
                        "schedule-proposal",
                        "event",
                        context.userId,
                        { resource, type, parentId, data: calendarData },
                        durationMinutes,
                    );

                    const request = await approvalService.createRequest({
                        userId: context.userId,
                        provider: "system",
                        externalContext: { source: "schedule_proposal" },
                        requestPayload: {
                            actionType: "schedule_proposal",
                            description: "Schedule proposal",
                            tool: "create",
                            originalIntent: "event",
                            args: { resource, type, parentId, data: calendarData },
                            options
                        },
                        idempotencyKey,
                        expiresInSeconds: 3600
                    } as Parameters<ApprovalService["createRequest"]>[0]);

                    const lines = options.map((option, index) => {
                        const start = new Date(option.start);
                        const end = option.end ? new Date(option.end) : undefined;
                        return `${index + 1}) ${formatSlotLabel(start, end, option.timeZone)}`;
                    });

                    let messageText = `Here are a few options:\n${lines.join("\n")}\nReply 1, 2, or 3.`;
                    const attendees = calendarData.attendees;
                    if (attendees?.length) {
                        const crossRef = await findCrossReferences({
                            userId: context.userId,
                            attendees,
                            subject: calendarData.title,
                            logger,
                        }).catch(() => null);
                        if (crossRef?.relatedEmails?.length) {
                            messageText += `\n\nYou have ${crossRef.relatedEmails.length} recent email(s) from attendees that might be relevant.`;
                        }
                    }

                    return {
                        success: true,
                        data: {
                            status: "schedule_proposal",
                            scheduleProposalId: request.id,
                            options
                        },
                        message: messageText
                    };
                }

                const ambiguityResolved = calendarData.ambiguityResolved === true;
                const localStartInput = parseLocalDateTimeInput(calendarData.start);
                if (!ambiguityResolved && localStartInput && isAmbiguousLocalTime(localStartInput, effectiveTimeZone)) {
                    const start = parsedStart as Date;
                    const end = parsedEnd ?? undefined;
                    const durationMs = end ? end.getTime() - start.getTime() : undefined;
                    const earlierStartUtc = (await import("date-fns-tz")).fromZonedTime(localStartInput, effectiveTimeZone);
                    const laterStartUtc = new Date(earlierStartUtc.getTime() + 60 * 60 * 1000);
                    const earlierEndUtc = durationMs ? new Date(earlierStartUtc.getTime() + durationMs) : undefined;
                    const laterEndUtc = durationMs ? new Date(laterStartUtc.getTime() + durationMs) : undefined;

                    const idempotencyKey = createDeterministicIdempotencyKey(
                        "ambiguous-create",
                        context.userId,
                        {
                            start: data.start,
                            end: calendarData.end,
                            timeZone: effectiveTimeZone,
                        },
                    );

                    const request = await approvalService.createRequest({
                        userId: context.userId,
                        provider: "system",
                        externalContext: { source: "ambiguous_time" },
                        requestPayload: {
                            actionType: "ambiguous_time",
                            tool: "create",
                            args: { resource, type, parentId, data: calendarData },
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
                    } as Parameters<ApprovalService["createRequest"]>[0]);

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

                const localEndInput = parseLocalDateTimeInput(calendarData.end);
                if (!ambiguityResolved && localEndInput && isAmbiguousLocalTime(localEndInput, effectiveTimeZone)) {
                    const start = parsedStart ?? undefined;
                    const earlierEndUtc = (await import("date-fns-tz")).fromZonedTime(localEndInput, effectiveTimeZone);
                    const laterEndUtc = new Date(earlierEndUtc.getTime() + 60 * 60 * 1000);
                    const earlierStartUtc = start ? new Date(start) : undefined;
                    const laterStartUtc = start ? new Date(start) : undefined;

                    const idempotencyKey = createDeterministicIdempotencyKey(
                        "ambiguous-create-end",
                        context.userId,
                        {
                            start: data.start,
                            end: calendarData.end,
                            timeZone: effectiveTimeZone,
                        },
                    );

                    const request = await approvalService.createRequest({
                        userId: context.userId,
                        provider: "system",
                        externalContext: { source: "ambiguous_time" },
                        requestPayload: {
                            actionType: "ambiguous_time",
                            tool: "create",
                            args: { resource, type, parentId, data: calendarData },
                            options: {
                                earlier: {
                                    start: earlierStartUtc?.toISOString(),
                                    end: earlierEndUtc.toISOString()
                                },
                                later: {
                                    start: laterStartUtc?.toISOString(),
                                    end: laterEndUtc.toISOString()
                                },
                                timeZone: effectiveTimeZone
                            },
                            message: "That time happens twice because of daylight saving. Which one did you mean?"
                        },
                        idempotencyKey,
                        expiresInSeconds: 3600
                    } as Parameters<ApprovalService["createRequest"]>[0]);

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

                const safety = await validateCalendarMutationSafety({
                    userId: context.userId,
                    emailAccountId,
                    mutation: "create",
                    providers: { calendar: providers.calendar },
                    proposedStart: parsedStart as Date,
                    proposedEnd: parsedEnd as Date,
                });
                if (!safety.ok) {
                    return {
                        success: false,
                        error: safety.error,
                        clarification: safety.clarification,
                    };
                }

                const event = await providers.calendar.createEvent({
                    calendarId: calendarData.calendarId,
                    input: {
                        title: calendarData.title,
                        description: calendarData.description,
                        location: calendarData.location,
                        start: parsedStart as Date,
                        end: parsedEnd as Date,
                        attendees: calendarData.attendees,
                        allDay: calendarData.allDay,
                        isRecurring: calendarData.isRecurring,
                        recurrenceRule: calendarData.recurrenceRule,
                        timeZone: effectiveTimeZone,
                        addGoogleMeet: true
                    }
                });
                await upsertCalendarEventShadow({
                    userId: context.userId,
                    emailAccountId,
                    event,
                    source: "ai",
                    metadata: { tool: "create", resource: "calendar" },
                }).catch((error) => {
                    logger.warn("Failed to upsert canonical event shadow after create", { error });
                });
                // Post-create task scheduling – best-effort; don't lose the event if this fails
                try {
                    await scheduleTasksForUser({ userId: context.userId, emailAccountId, source: "ai" });
                } catch (taskErr) {
                    logger.warn("Post-event scheduleTasksForUser failed (event was still created)", { error: taskErr });
                }
                const requestedAttendees = calendarData.attendees ?? [];
                const message =
                    requestedAttendees.length === 0
                        ? "Calendar event created successfully. No attendees were added because none were specified."
                        : attendeeResolution.reason === "resolved_from_context"
                            ? `Calendar event created successfully with ${requestedAttendees.length} attendee(s) resolved from conversation context.`
                            : attendeeResolution.autoResolved
                            ? `Calendar event created successfully with ${requestedAttendees.length} attendee(s) resolved from your contacts.`
                            : `Calendar event created successfully for ${requestedAttendees.length} attendee(s).`;
                return { success: true, data: event, message };

            case "task":
                if (!data.title) {
                    return { success: false, error: "Task title is required" };
                }

                if (data.isAutoScheduled && !data.scheduledStart && !data.scheduledEnd) {
                    const preferences = await prisma.taskPreference.findUnique({
                        where: { userId: context.userId }
                    });
                    if (!preferences) {
                        return { success: false, error: "Task preferences not found for scheduling" };
                    }

                    const resolvedEmailAccountId = await resolveSchedulingEmailAccountId({
                        userId: context.userId,
                        emailAccountId,
                        selectedCalendarIds: preferences.selectedCalendarIds,
                        logger,
                    });

                    const defaultCalendarTimeZone = await resolveDefaultCalendarTimeZone({
                        userId: context.userId,
                        emailAccountId: resolvedEmailAccountId,
                    });
                    if ("error" in defaultCalendarTimeZone) {
                        return { success: false, error: defaultCalendarTimeZone.error };
                    }
                    let taskSchedulingTimeZone = defaultCalendarTimeZone.timeZone;
                    if (preferences.timeZone) {
                        const timeZoneResult = resolveTimeZoneOrUtc(preferences.timeZone);
                        if (!timeZoneResult.isFallback) {
                            taskSchedulingTimeZone = timeZoneResult.timeZone;
                        } else {
                            logger.warn("Invalid task preference time zone; using calendar integration timezone", {
                                originalTimeZone: timeZoneResult.original,
                                resolvedTimeZone: defaultCalendarTimeZone.timeZone,
                            });
                        }
                    }

                    const settings = {
                        workHourStart: preferences.workHourStart,
                        workHourEnd: preferences.workHourEnd,
                        workDays: preferences.workDays,
                        bufferMinutes: preferences.bufferMinutes,
                        selectedCalendarIds: preferences.selectedCalendarIds,
                        timeZone: taskSchedulingTimeZone,
                        groupByProject: preferences.groupByProject,
                    };

                    const calendarService = new CalendarServiceImpl(resolvedEmailAccountId, logger);
                    const timeSlotManager = new TimeSlotManagerImpl(settings, calendarService);
                    const now = new Date();
                    const taskWindowEnd = addDays(now, 7);
                    const slots = await timeSlotManager.findAvailableSlots({
                        id: "preview",
                        userId: context.userId,
                        title: data.title,
                        durationMinutes: data.durationMinutes ?? 30,
                        status: "PENDING",
                        priority: data.priority ?? "NONE",
                        energyLevel: data.energyLevel ?? null,
                        preferredTime: data.preferredTime ?? null,
                        dueDate: data.dueDate ? new Date(data.dueDate) : null,
                        startDate: data.startDate ? new Date(data.startDate) : null,
                        scheduleLocked: false,
                        isAutoScheduled: true,
                        scheduledStart: null,
                        scheduledEnd: null,
                        scheduleScore: null,
                    }, now, taskWindowEnd);

                    const options = slots.slice(0, 3).map((slot) => ({
                        start: slot.start.toISOString(),
                        end: slot.end.toISOString(),
                        timeZone: taskSchedulingTimeZone
                    }));
                    if (options.length === 0) {
                        return { success: false, error: "No available slots found" };
                    }

                    const idempotencyKey = createDeterministicIdempotencyKey(
                        "schedule-proposal",
                        "task",
                        context.userId,
                        { resource, type, parentId, data },
                    );

                    const request = await approvalService.createRequest({
                        userId: context.userId,
                        provider: "system",
                        externalContext: { source: "schedule_proposal" },
                        requestPayload: {
                            actionType: "schedule_proposal",
                            description: "Schedule proposal",
                            tool: "create",
                            originalIntent: "task",
                            args: { resource, type, parentId, data },
                            options
                        },
                        idempotencyKey,
                        expiresInSeconds: 3600
                    } as Parameters<ApprovalService["createRequest"]>[0]);

                    const lines = options.map((option, index) => {
                        const start = new Date(option.start);
                        const end = option.end ? new Date(option.end) : undefined;
                        return `${index + 1}) ${formatSlotLabel(start, end, option.timeZone)}`;
                    });

                    return {
                        success: true,
                        data: {
                            status: "schedule_proposal",
                            scheduleProposalId: request.id,
                            options
                        },
                        message: `Here are a few options:\n${lines.join("\n")}\nReply 1, 2, or 3.`
                    };
                }

                const task = await prisma.task.create({
                    data: {
                        userId: context.userId,
                        title: data.title,
                        description: data.description ?? null,
                        durationMinutes: data.durationMinutes ?? null,
                        status: data.status ?? "PENDING",
                        priority: data.priority ?? "NONE",
                        energyLevel: data.energyLevel ?? null,
                        preferredTime: data.preferredTime ?? null,
                        dueDate: data.dueDate ? new Date(data.dueDate) : null,
                        startDate: data.startDate ? new Date(data.startDate) : null,
                        isAutoScheduled: data.isAutoScheduled ?? true,
                        scheduleLocked: data.scheduleLocked ?? false,
                        reschedulePolicy: data.reschedulePolicy ?? "FLEXIBLE",
                        scheduledStart: data.scheduledStart ? new Date(data.scheduledStart) : null,
                        scheduledEnd: data.scheduledEnd ? new Date(data.scheduledEnd) : null,
                        sourceEmailMessageId: context.emailMessageId ?? undefined,
                        sourceConversationId: context.conversationId ?? undefined,
                    }
                });

                if (task.isAutoScheduled && !task.scheduledStart && !task.scheduledEnd) {
                    await scheduleTasksForUser({ userId: context.userId, emailAccountId, source: "ai" });
                }

                return { success: true, data: task };

            case "category": {
                const name = (data.name ?? data.categoryName) as string | undefined;
                if (!name?.trim()) {
                    return { success: false, error: "Category name is required" };
                }
                const { getOrCreateCategory } = await import("@/features/categories/resolve");
                const categoryId = await getOrCreateCategory({
                    userId: context.userId,
                    name: name.trim(),
                    description: (data.description as string) ?? undefined,
                    isLearned: (data.isLearned as boolean) ?? false,
                });
                return { success: true, data: { categoryId } };
            }

            case "automation":
                // Create learned-patterns group for an existing rule
                if (data.createGroup === true && data.ruleId) {
                    const { createGroupAction } = await import("@/server/actions/group");
                    const result = await createGroupAction(emailAccountId, {
                        ruleId: data.ruleId,
                    });
                    return { success: true, data: result };
                }
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
