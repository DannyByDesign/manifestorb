
import { z } from "zod";
import { env } from "@/env";
import { type ToolDefinition } from "./types";
import { isGoogleProvider } from "@/features/email/provider-types";
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
import { scheduleTasksForUser, resolveSchedulingEmailAccountId } from "@/features/calendar/scheduling/TaskSchedulingService";
import { addDays, isAmbiguousLocalTime, resolveTimeZoneOrUtc } from "@/features/calendar/scheduling/date-utils";
import { CalendarServiceImpl } from "@/features/calendar/scheduling/CalendarServiceImpl";
import { TimeSlotManagerImpl } from "@/features/calendar/scheduling/TimeSlotManager";
import { ApprovalService } from "@/features/approvals/service";
import { createHash } from "crypto";

const router = new ChannelRouter();
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

const createParameters = z.object({
    resource: z.enum(["email", "calendar", "automation", "knowledge", "drive", "notification", "contacts", "task"]),
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
        title: z.string().optional().describe("Event or task title. Infer from the user's request."),
        description: z.string().optional(),
        start: z.string().optional().describe("ISO 8601 start time. Omit when using autoSchedule."),
        end: z.string().optional().describe("ISO 8601 end time. Omit when using autoSchedule."),
        durationMinutes: z.number().min(5).max(480).optional().describe("Meeting duration in minutes. Defaults to 30 if omitted."),
        autoSchedule: z.boolean().optional().describe("Set true to find 3 available calendar slots automatically. Use this when the user wants to schedule but hasn't specified an exact time."),
        calendarId: z.string().optional(),
        allDay: z.boolean().optional(),
        isRecurring: z.boolean().optional(),
        recurrenceRule: z.string().optional(),
        timeZone: z.string().optional(),
        attendees: z.array(z.string()).optional(),
        location: z.string().optional(),
        ambiguityResolved: z.boolean().optional(),

        // Task
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

        // Automation
        name: z.string().optional(),
        conditions: z.unknown().optional(),
        actions: z.array(z.unknown()).optional(),

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
});

export const createTool: ToolDefinition<typeof createParameters> = {
    name: "create",
    description: `Create new items.

Email: Creates a DRAFT only. User must manually send from UI.
- type: "new" | "reply" | "forward"
- For reply/forward: provide parentId (thread ID / message ID)
- Returns: { draftId, previewUrl } for user to review and send

Calendar (scheduling): When the user wants to schedule a meeting, call, or appointment (any intent to find time):
- Set resource="calendar", data.autoSchedule=true. Use data.title from the message if given, otherwise use a generic title like "Meeting". data.durationMinutes defaults to 30; data.timeZone if known.
- Do NOT ask who the meeting is with or for a specific day/time first — call this tool immediately. It returns 3 available slots; present them as options 1, 2, 3. If the user used a pronoun ("them", "this person"), use a generic title and still call the tool.
- If the user has a pending schedule proposal (see Pending State), interpret their reply (e.g. "the first one", "Tuesday") and resolve via the approval flow.
- For a specific time: set data.start and data.end (ISO strings) instead of autoSchedule.

Task: Creates a task and optionally auto-schedules it. If flexibility is not specified by the user, choose a reschedulePolicy.

Automation: Create Rules & Knowledge supported.`,

    parameters: createParameters,



    execute: async ({ resource, type, parentId, data }, context) => {
        const { emailAccountId, providers } = context;
        switch (resource) {
            case "email":
                let replyContext = null;
                const emailAccount = await getEmailAccountWithAi({ emailAccountId: context.emailAccountId });
                if (!emailAccount || !emailAccount.account?.provider) {
                    return { success: false, error: "Email account not found" };
                }
                const isReply = type === "reply";

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
                const draftResult = await providers.email.createDraft({
                    type: (type as "new" | "reply" | "forward") || "new",
                    parentId,
                    to: data.to,
                    cc: data.cc,
                    bcc: data.bcc,
                    subject: data.subject,
                    body: data.body
                });

                // Build summary for interactive UI
                const recipients = data.to?.join(", ") || "unknown";
                const subjectLine = data.subject || "(no subject)";

                const actions = [
                    { label: "Send", style: "primary" as const, value: "send" },
                ] as Array<{ label: string; style: "primary" | "danger"; value: string; url?: string }>;
                if (isGoogleProvider(emailAccount.account.provider)) {
                    const draftUrl = `https://mail.google.com/mail/u/0/#drafts/${draftResult.draftId}`;
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
                        draftId: draftResult.draftId,
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

                if (data.autoSchedule || !data.start || !data.end) {
                    const durationMinutes = data.durationMinutes || 30;
                    const slots = await providers.calendar.findAvailableSlots({
                        durationMinutes,
                        start: data.start ? new Date(data.start) : undefined,
                        end: data.end ? new Date(data.end) : undefined
                    });
                    const timeZoneResult = resolveTimeZoneOrUtc(data.timeZone);
                    const options = slots.slice(0, 3).map((slot) => ({
                        start: slot.start.toISOString(),
                        end: slot.end.toISOString(),
                        timeZone: timeZoneResult.timeZone
                    }));
                    if (options.length === 0) {
                        return { success: false, error: "No available slots found" };
                    }

                    const idempotencyKey = createHash("sha256")
                        .update(`schedule-proposal:event:${context.userId}:${JSON.stringify(data)}:${durationMinutes}`)
                        .digest("hex");

                    const request = await approvalService.createRequest({
                        userId: context.userId,
                        provider: "system",
                        externalContext: { source: "schedule_proposal" },
                        requestPayload: {
                            actionType: "schedule_proposal",
                            description: "Schedule proposal",
                            tool: "create",
                            originalIntent: "event",
                            args: { resource, type, parentId, data },
                            options
                        },
                        idempotencyKey,
                        expiresInSeconds: 3600
                    } as any);

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

                const timeZoneResult = resolveTimeZoneOrUtc(data.timeZone);
                if (timeZoneResult.isFallback && data.timeZone) {
                    logger.warn("Invalid time zone for calendar create; falling back to UTC", {
                        originalTimeZone: data.timeZone
                    });
                }

                const ambiguityResolved = (data as any).ambiguityResolved === true;
                if (!ambiguityResolved && data.timeZone && data.start && isAmbiguousLocalTime(new Date(data.start), timeZoneResult.timeZone)) {
                    const start = new Date(data.start);
                    const end = data.end ? new Date(data.end) : undefined;
                    const durationMs = end ? end.getTime() - start.getTime() : undefined;
                    const earlierStart = new Date(start);
                    const earlierStartUtc = (await import("date-fns-tz")).fromZonedTime(earlierStart, timeZoneResult.timeZone);
                    const laterStartUtc = new Date(earlierStartUtc.getTime() + 60 * 60 * 1000);
                    const earlierEndUtc = durationMs ? new Date(earlierStartUtc.getTime() + durationMs) : undefined;
                    const laterEndUtc = durationMs ? new Date(laterStartUtc.getTime() + durationMs) : undefined;

                    const idempotencyKey = createHash("sha256")
                        .update(`ambiguous-create:${context.userId}:${data.start}:${data.end}:${timeZoneResult.timeZone}`)
                        .digest("hex");

                    const request = await approvalService.createRequest({
                        userId: context.userId,
                        provider: "system",
                        externalContext: { source: "ambiguous_time" },
                        requestPayload: {
                            actionType: "ambiguous_time",
                            tool: "create",
                            args: { resource, type, parentId, data },
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

                if (!ambiguityResolved && data.timeZone && data.end && isAmbiguousLocalTime(new Date(data.end), timeZoneResult.timeZone)) {
                    const end = new Date(data.end);
                    const start = data.start ? new Date(data.start) : undefined;
                    const earlierEndUtc = (await import("date-fns-tz")).fromZonedTime(end, timeZoneResult.timeZone);
                    const laterEndUtc = new Date(earlierEndUtc.getTime() + 60 * 60 * 1000);
                    const earlierStartUtc = start ? new Date(start) : undefined;
                    const laterStartUtc = start ? new Date(start) : undefined;

                    const idempotencyKey = createHash("sha256")
                        .update(`ambiguous-create-end:${context.userId}:${data.start}:${data.end}:${timeZoneResult.timeZone}`)
                        .digest("hex");

                    const request = await approvalService.createRequest({
                        userId: context.userId,
                        provider: "system",
                        externalContext: { source: "ambiguous_time" },
                        requestPayload: {
                            actionType: "ambiguous_time",
                            tool: "create",
                            args: { resource, type, parentId, data },
                            options: {
                                earlier: {
                                    start: earlierStartUtc?.toISOString(),
                                    end: earlierEndUtc.toISOString()
                                },
                                later: {
                                    start: laterStartUtc?.toISOString(),
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

                const event = await providers.calendar.createEvent({
                    calendarId: data.calendarId,
                    input: {
                        title: data.title,
                        description: data.description,
                        location: data.location,
                        start: new Date(data.start),
                        end: new Date(data.end),
                        allDay: data.allDay,
                        isRecurring: data.isRecurring,
                        recurrenceRule: data.recurrenceRule,
                        timeZone: timeZoneResult.timeZone,
                        addGoogleMeet: true
                    }
                });
                await scheduleTasksForUser({ userId: context.userId, emailAccountId, source: "ai" });
                return { success: true, data: event };

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

                    const timeZoneResult = resolveTimeZoneOrUtc(preferences.timeZone);
                    const settings = {
                        workHourStart: preferences.workHourStart,
                        workHourEnd: preferences.workHourEnd,
                        workDays: preferences.workDays,
                        bufferMinutes: preferences.bufferMinutes,
                        selectedCalendarIds: preferences.selectedCalendarIds,
                        timeZone: timeZoneResult.timeZone,
                        groupByProject: preferences.groupByProject,
                    };

                    const resolvedEmailAccountId = await resolveSchedulingEmailAccountId({
                        userId: context.userId,
                        emailAccountId,
                        selectedCalendarIds: preferences.selectedCalendarIds,
                        logger,
                    });

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
                        timeZone: timeZoneResult.timeZone
                    }));
                    if (options.length === 0) {
                        return { success: false, error: "No available slots found" };
                    }

                    const idempotencyKey = createHash("sha256")
                        .update(`schedule-proposal:task:${context.userId}:${JSON.stringify(data)}`)
                        .digest("hex");

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
                    } as any);

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
                    }
                });

                if (task.isAutoScheduled && !task.scheduledStart && !task.scheduledEnd) {
                    await scheduleTasksForUser({ userId: context.userId, emailAccountId, source: "ai" });
                }

                return { success: true, data: task };

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
