import { z } from "zod";
import { type ToolDefinition, type ToolResult } from "./types";
import prisma from "@/server/db/client";
import type { Contact } from "@/features/email/types";
import type { CalendarEvent } from "@/features/calendar/event-types";
import type { ParsedMessage } from "@/server/lib/types";

const parseFilterObject = <T extends z.ZodTypeAny>(schema: T) =>
    z.preprocess(
        (value) => {
            if (typeof value !== "string") return value;
            try {
                return JSON.parse(value) as Record<string, unknown>;
            } catch {
                return undefined;
            }
        },
        schema,
    );

const dateRangeSchema = z
    .object({
        after: z.string().optional(),
        before: z.string().optional(),
    })
    .strict();

const limitSchema = z.number().int().min(1).max(100).optional();

const queryParameters = z.discriminatedUnion("resource", [
    z.object({
        resource: z.literal("email"),
        filter: parseFilterObject(
            z
                .object({
                    query: z.string().optional(),
                    dateRange: dateRangeSchema.optional(),
                    limit: limitSchema,
                    pageToken: z.string().optional(),
                    fetchAll: z.boolean().optional().default(false),
                })
                .strict()
                .optional(),
        ),
    }),
    z.object({
        resource: z.literal("calendar"),
        filter: parseFilterObject(
            z
                .object({
                    query: z.string().optional(),
                    attendeeEmail: z.string().email().optional(),
                    dateRange: dateRangeSchema.optional(),
                    limit: limitSchema,
                })
                .strict()
                .optional(),
        ),
    }),
    z.object({
        resource: z.literal("contacts"),
        filter: parseFilterObject(
            z
                .object({
                    query: z.string().optional(),
                    limit: limitSchema,
                })
                .strict()
                .optional(),
        ),
    }),
    z.object({
        resource: z.literal("task"),
        filter: parseFilterObject(
            z
                .object({
                    query: z.string().optional(),
                    limit: limitSchema,
                })
                .strict()
                .optional(),
        ),
    }),
    z.object({
        resource: z.literal("approval"),
        filter: parseFilterObject(
            z
                .object({
                    status: z
                        .enum(["PENDING", "APPROVED", "DENIED", "EXPIRED", "CANCELLED"])
                        .optional(),
                    limit: limitSchema,
                })
                .strict()
                .optional(),
        ),
    }),
    z.object({
        resource: z.literal("notification"),
        filter: parseFilterObject(
            z
                .object({
                    query: z.string().optional(),
                    type: z.string().optional(),
                    limit: limitSchema,
                })
                .strict()
                .optional(),
        ),
    }),
    z.object({
        resource: z.literal("draft"),
        filter: parseFilterObject(
            z
                .object({
                    query: z.string().optional(),
                    limit: limitSchema,
                })
                .strict()
                .optional(),
        ),
    }),
    z.object({
        resource: z.literal("conversation"),
        filter: parseFilterObject(
            z
                .object({
                    query: z.string().optional(),
                    limit: limitSchema,
                })
                .strict()
                .optional(),
        ),
    }),
    z.object({
        resource: z.literal("preferences"),
        filter: parseFilterObject(z.object({}).strict().optional()),
    }),
]);

type QueryParams = z.infer<typeof queryParameters>;
type QueryResource = QueryParams["resource"];
type QueryContext = Parameters<ToolDefinition<typeof queryParameters>["execute"]>[1];
type FilterFor<R extends QueryResource> = Extract<QueryParams, { resource: R }>["filter"];

type QueryListItem = {
    id: string;
    title: string;
    snippet: string;
    source: QueryResource;
    date?: string | Date;
    data?: unknown;
};

function parseDateBound(value: string | undefined): Date | null {
    if (!value) return null;
    const parsed = new Date(value);
    return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function normalizeLimit(limit: number | undefined): number {
    return limit ?? 100;
}

function getRangeError(filter: { dateRange?: { after?: string; before?: string } } | undefined): string | null {
    if (!filter?.dateRange) return null;
    const { after, before } = filter.dateRange;
    if (after && !parseDateBound(after)) return "Invalid dateRange.after. Use an ISO-8601 timestamp.";
    if (before && !parseDateBound(before)) return "Invalid dateRange.before. Use an ISO-8601 timestamp.";
    return null;
}

async function handleEmailQuery(
    filter: FilterFor<"email">,
    context: QueryContext,
): Promise<ToolResult> {
    const limit = normalizeLimit(filter?.limit);
    const dateRangeError = getRangeError(filter);
    if (dateRangeError) {
        return { success: false, error: dateRangeError };
    }

    try {
        const result = await context.providers.email.search({
            query: filter?.query ?? "",
            limit: filter?.fetchAll ? undefined : limit,
            fetchAll: filter?.fetchAll,
            pageToken: filter?.pageToken,
            before: parseDateBound(filter?.dateRange?.before) ?? undefined,
            after: parseDateBound(filter?.dateRange?.after) ?? undefined,
        });

        const data: QueryListItem[] = result.messages.map((message: ParsedMessage) => ({
            id: message.id,
            title: message.subject || "(No Subject)",
            snippet: message.snippet || message.textPlain?.substring(0, 150) || "",
            date: message.date,
            source: "email",
            data: {
                from: message.headers?.from,
                threadId: message.threadId,
            },
        }));

        return {
            success: true,
            data,
            ...(result.nextPageToken
                ? {
                      truncated: true,
                      message: `Showing ${result.messages.length} of ~${result.totalEstimate ?? "many"} results. More are available.`,
                  }
                : {}),
            paging: {
                nextPageToken: result.nextPageToken ?? null,
                totalEstimate: result.totalEstimate ?? null,
            },
        } as ToolResult;
    } catch (error: unknown) {
        const message = error instanceof Error ? error.message : String(error);
        return {
            success: false,
            error: `Email search failed: ${message}`,
        };
    }
}

async function resolveCalendarRange(
    userId: string,
    filter: FilterFor<"calendar">,
): Promise<{ start: Date; end: Date } | { error: string }> {
    const rangeError = getRangeError(filter);
    if (rangeError) return { error: rangeError };

    const preferences = await prisma.taskPreference.findUnique({
        where: { userId },
        select: { timeZone: true },
    });
    const timeZone = preferences?.timeZone ?? "UTC";

    if (filter?.dateRange?.after || filter?.dateRange?.before) {
        const start = parseDateBound(filter?.dateRange?.after) ?? new Date();
        const end = parseDateBound(filter?.dateRange?.before) ?? new Date(start.getTime() + 24 * 60 * 60 * 1000);
        return { start, end };
    }

    const { fromZonedTime, toZonedTime } = await import("date-fns-tz");
    const nowLocal = toZonedTime(new Date(), timeZone);

    const startOfDay = new Date(nowLocal);
    startOfDay.setHours(0, 0, 0, 0);

    const endOfDay = new Date(nowLocal);
    endOfDay.setHours(23, 59, 59, 999);

    return {
        start: fromZonedTime(startOfDay, timeZone),
        end: fromZonedTime(endOfDay, timeZone),
    };
}

async function handleCalendarQuery(
    filter: FilterFor<"calendar">,
    context: QueryContext,
): Promise<ToolResult> {
    const limit = normalizeLimit(filter?.limit);
    const range = await resolveCalendarRange(context.userId, filter);
    if ("error" in range) {
        return { success: false, error: range.error };
    }

    const events = await context.providers.calendar.searchEvents(filter?.query ?? "", range);
    const attendeeFilter = filter?.attendeeEmail?.toLowerCase();

    const filtered = attendeeFilter
        ? events.filter((event: CalendarEvent) =>
              event.attendees.some((attendee) => attendee.email.toLowerCase() === attendeeFilter),
          )
        : events;

    const data: QueryListItem[] = filtered.slice(0, limit).map((event: CalendarEvent) => ({
        id: event.id,
        title: event.title || "(No Title)",
        snippet: `Time: ${event.startTime.toISOString()} - ${event.endTime.toISOString()}. Attendees: ${event.attendees
            .map((attendee) => attendee.email)
            .join(", ")}`,
        date: event.startTime,
        source: "calendar",
        data: {
            location: event.location,
            eventUrl: event.eventUrl,
            videoConferenceLink: event.videoConferenceLink,
        },
    }));

    return {
        success: true,
        data,
        message: data.length === 0 ? "No events in that range." : "Here are your calendar events.",
    };
}

async function handleContactsQuery(
    filter: FilterFor<"contacts">,
    context: QueryContext,
): Promise<ToolResult> {
    try {
        const contacts = await context.providers.email.searchContacts(filter?.query ?? "");
        const limit = normalizeLimit(filter?.limit);
        const data: QueryListItem[] = contacts.slice(0, limit).map((contact: Contact) => ({
            id: contact.id ?? contact.email ?? contact.name,
            title: contact.name,
            snippet: `Email: ${contact.email || "N/A"}. Phone: ${contact.phone || "N/A"}. Company: ${contact.company || "N/A"}`,
            source: "contacts",
            data: contact,
        }));

        return { success: true, data };
    } catch (error: unknown) {
        const message = error instanceof Error ? error.message : String(error);
        return { success: false, error: `Contacts search failed: ${message}` };
    }
}

async function handleTaskQuery(
    filter: FilterFor<"task">,
    context: QueryContext,
): Promise<ToolResult> {
    const where = {
        userId: context.userId,
        ...(filter?.query
            ? {
                  OR: [
                      { title: { contains: filter.query, mode: "insensitive" as const } },
                      { description: { contains: filter.query, mode: "insensitive" as const } },
                  ],
              }
            : {}),
    };

    const tasks = await prisma.task.findMany({
        where,
        orderBy: { updatedAt: "desc" },
        take: normalizeLimit(filter?.limit),
    });

    const data: QueryListItem[] = tasks.map((task) => ({
        id: task.id,
        title: task.title,
        snippet: task.description || "",
        date: task.updatedAt,
        source: "task",
        data: task,
    }));

    return { success: true, data };
}

async function handleApprovalQuery(
    filter: FilterFor<"approval">,
    context: QueryContext,
): Promise<ToolResult> {
    const approvals = await prisma.approvalRequest.findMany({
        where: {
            userId: context.userId,
            ...(filter?.status ? { status: filter.status } : {}),
        },
        orderBy: { createdAt: "desc" },
        take: normalizeLimit(filter?.limit),
    });

    const data: QueryListItem[] = approvals.map((approval) => {
        const payload =
            approval.requestPayload && typeof approval.requestPayload === "object"
                ? (approval.requestPayload as Record<string, unknown>)
                : {};
        const description =
            typeof payload.description === "string" && payload.description.length > 0
                ? payload.description
                : "Approval request";

        return {
            id: approval.id,
            title: description,
            snippet: `Status: ${approval.status}`,
            date: approval.createdAt,
            source: "approval",
            data: {
                expiresAt: approval.expiresAt,
                payload,
            },
        };
    });

    return { success: true, data };
}

async function handleNotificationQuery(
    filter: FilterFor<"notification">,
    context: QueryContext,
): Promise<ToolResult> {
    const notifications = await prisma.inAppNotification.findMany({
        where: {
            userId: context.userId,
            ...(filter?.type
                ? {
                      type: {
                          equals: filter.type,
                          mode: "insensitive" as const,
                      },
                  }
                : {}),
            ...(filter?.query
                ? {
                      OR: [
                          { title: { contains: filter.query, mode: "insensitive" as const } },
                          { body: { contains: filter.query, mode: "insensitive" as const } },
                      ],
                  }
                : {}),
        },
        orderBy: { createdAt: "desc" },
        take: normalizeLimit(filter?.limit),
        select: {
            id: true,
            title: true,
            body: true,
            type: true,
            readAt: true,
            createdAt: true,
            metadata: true,
        },
    });

    const data: QueryListItem[] = notifications.map((notification) => ({
        id: notification.id,
        title: notification.title,
        snippet: notification.body || "",
        date: notification.createdAt,
        source: "notification",
        data: {
            type: notification.type,
            readAt: notification.readAt,
            metadata: notification.metadata,
        },
    }));

    return {
        success: true,
        data,
        message: data.length === 0 ? "No notifications found." : `Found ${data.length} notification(s).`,
    };
}

async function handleDraftQuery(
    filter: FilterFor<"draft">,
    context: QueryContext,
): Promise<ToolResult> {
    try {
        const drafts = await context.providers.email.getDrafts({
            maxResults: normalizeLimit(filter?.limit),
        });

        const normalizedQuery = filter?.query?.toLowerCase().trim();
        const filteredDrafts = normalizedQuery
            ? drafts.filter((draft) => {
                  const subject = draft.headers?.subject?.toLowerCase() ?? "";
                  const body = draft.textPlain?.toLowerCase() ?? "";
                  const from = draft.headers?.from?.toLowerCase() ?? "";
                  return (
                      subject.includes(normalizedQuery) ||
                      body.includes(normalizedQuery) ||
                      from.includes(normalizedQuery)
                  );
              })
            : drafts;

        const data: QueryListItem[] = filteredDrafts.map((draft: ParsedMessage) => ({
            id: draft.id,
            title: draft.headers?.subject || "(No subject)",
            snippet: draft.textPlain?.substring(0, 200) || "",
            date: draft.date,
            source: "draft",
            data: {
                from: draft.headers?.from,
                threadId: draft.threadId,
            },
        }));

        return {
            success: true,
            data,
            message: data.length === 0 ? "No drafts found." : `Found ${data.length} draft(s).`,
        };
    } catch (error: unknown) {
        const message = error instanceof Error ? error.message : String(error);
        return { success: false, error: `Draft listing failed: ${message}` };
    }
}

async function handleConversationQuery(
    filter: FilterFor<"conversation">,
    context: QueryContext,
): Promise<ToolResult> {
    const conversations = await prisma.conversation.findMany({
        where: {
            userId: context.userId,
            ...(filter?.query
                ? {
                      messages: {
                          some: {
                              content: { contains: filter.query, mode: "insensitive" as const },
                          },
                      },
                  }
                : {}),
        },
        orderBy: { updatedAt: "desc" },
        take: normalizeLimit(filter?.limit),
        include: {
            messages: {
                orderBy: { createdAt: "desc" },
                take: 3,
                select: {
                    role: true,
                    content: true,
                    createdAt: true,
                    provider: true,
                },
            },
        },
    });

    const data = conversations.map((conversation) => ({
        id: conversation.id,
        title: `Conversation (${conversation.provider})`,
        snippet: conversation.messages[0]?.content?.slice(0, 200) ?? "",
        source: "conversation" as const,
        date: conversation.updatedAt,
        data: {
            provider: conversation.provider,
            updatedAt: conversation.updatedAt,
            recentMessages: conversation.messages,
        },
    }));

    return {
        success: true,
        data,
        message: data.length === 0 ? "No conversations found." : `Found ${data.length} conversation(s).`,
    };
}

async function handlePreferencesQuery(context: QueryContext): Promise<ToolResult> {
    const [emailAccount, taskPreference] = await Promise.all([
        prisma.emailAccount.findFirst({
            where: { userId: context.userId },
            select: {
                about: true,
                statsEmailFrequency: true,
                summaryEmailFrequency: true,
            },
        }),
        prisma.taskPreference.findUnique({
            where: { userId: context.userId },
            select: {
                workHourStart: true,
                workHourEnd: true,
                workDays: true,
                bufferMinutes: true,
                timeZone: true,
            },
        }),
    ]);

    return {
        success: true,
        data: {
            email: emailAccount,
            scheduling: taskPreference,
        },
        message: "Current preferences loaded.",
    };
}

export const queryTool: ToolDefinition<typeof queryParameters> = {
    name: "query",
    description: `Search and retrieve items from supported assistant resources.

When to use:
- Use query to discover candidates and IDs (lists/search results).
- Use get when you already have IDs and need full details.
- Use analyze for reasoning/summaries over selected items.

Resources:
- email: Search emails (supports Gmail/Outlook query syntax) with pagination/date windows.
- calendar: Search events by date range, attendees, title.
- task: Search tasks by title/description.
- approval: List approval requests, optionally filtered by status.
- notification: Search notifications by title/body, filter by type.
- draft: List email drafts, optionally filter by query.
- conversation: Search conversation history.
- preferences: Read current email and scheduling preferences.
- contacts: Search known contacts.`,
    parameters: queryParameters,
    execute: async ({ resource, filter }, context) => {
        switch (resource) {
            case "email":
                return handleEmailQuery(filter, context);
            case "calendar":
                return handleCalendarQuery(filter, context);
            case "contacts":
                return handleContactsQuery(filter, context);
            case "task":
                return handleTaskQuery(filter, context);
            case "approval":
                return handleApprovalQuery(filter, context);
            case "notification":
                return handleNotificationQuery(filter, context);
            case "draft":
                return handleDraftQuery(filter, context);
            case "conversation":
                return handleConversationQuery(filter, context);
            case "preferences":
                return handlePreferencesQuery(context);
            default:
                return { success: false, error: `Resource ${resource} not supported yet` };
        }
    },
    securityLevel: "SAFE",
};
