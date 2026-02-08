
import { z } from "zod";
import { type ToolDefinition } from "./types";
import prisma from "@/server/db/client";
import { getEmailAccountWithAi } from "@/server/lib/user/get";

const parseFilterObject = <T extends z.ZodTypeAny>(schema: T) =>
    z.preprocess(
        (v) =>
            typeof v === "string"
                ? (() => {
                      try {
                          return JSON.parse(v) as Record<string, unknown>;
                      } catch {
                          return undefined;
                      }
                  })()
                : v,
        schema,
    );

const dateRangeSchema = z.object({
    after: z.string().optional(),
    before: z.string().optional(),
}).strict();

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
                    fetchAll: z.boolean().default(false),
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
        resource: z.literal("drive"),
        filter: parseFilterObject(
            z
                .object({
                    query: z.string().optional(),
                    id: z.string().optional(),
                    limit: limitSchema,
                })
                .strict()
                .optional(),
        ),
    }),
    z.object({
        resource: z.literal("automation"),
        filter: parseFilterObject(
            z
                .object({
                    limit: limitSchema,
                })
                .strict()
                .optional(),
        ),
    }),
    z.object({
        resource: z.literal("knowledge"),
        filter: parseFilterObject(
            z
                .object({
                    limit: limitSchema,
                })
                .strict()
                .optional(),
        ),
    }),
    z.object({
        resource: z.literal("report"),
        filter: parseFilterObject(z.object({}).strict().optional()),
    }),
    z.object({
        resource: z.literal("patterns"),
        filter: parseFilterObject(
            z.object({
                id: z.string(),
            }).strict(),
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
                    status: z.enum(["PENDING", "APPROVED", "DENIED", "EXPIRED", "CANCELLED"]).optional(),
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

export const queryTool: ToolDefinition<any> = {
    name: "query",
    description: `Search and retrieve items from any resource.

When to use:
- Use query to discover candidates and IDs (lists/search results).
- Use get when you already have IDs and need full details.
- Use analyze for reasoning/summaries over selected items.

Resources:
- email: Search emails (supports Gmail/Outlook query syntax). Supports dateRange.after/before and pageToken for pagination windows. Use fetchAll: true when the user wants ALL matching results: counts ("how many total"), bulk actions ("delete all", "clean up all", "remove all", "trash all"), or finding every match ("find every", "every email matching"). Without fetchAll, returns up to limit (default 100). If truncated, the response indicates more are available.
- calendar: Search events by date range, attendees, title
- task: Search tasks by title/description
- automation: List rules and their configurations
- approval: List approval requests, optionally filtered by status
- notification: Search notifications by title/body, filter by type
- draft: List email drafts, optionally filter by query
- conversation: Search conversation history across all platforms
- preferences: Read current email and scheduling preferences`,

    parameters: queryParameters,

    execute: async ({ resource, filter }, { emailAccountId, providers, userId }) => {
        const limit = filter?.limit ?? 100;

        switch (resource) {
            case "email":
                try {
                    const result = await providers.email.search({
                        query: filter?.query || "",
                        limit: filter?.fetchAll ? undefined : limit,
                        fetchAll: filter?.fetchAll,
                        pageToken: filter?.pageToken,
                        before: filter?.dateRange?.before ? new Date(filter.dateRange.before) : undefined,
                        after: filter?.dateRange?.after ? new Date(filter.dateRange.after) : undefined,
                    });
                    return {
                        success: true,
                        data: result.messages.map((e: { id: string; subject?: string; snippet?: string; body?: string; date?: Date; from?: string }) => ({
                            id: e.id,
                            title: e.subject || "(No Subject)",
                            snippet: e.snippet || e.body?.substring(0, 150) || "",
                            date: e.date,
                            source: "email",
                            from: e.from
                        })),
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
                    };
                } catch (emailErr: unknown) {
                    const msg = emailErr instanceof Error ? emailErr.message : String(emailErr);
                    return {
                        success: false,
                        error: `Email search failed: ${msg}`,
                    };
                }

            case "drive":
                if (!providers.drive) {
                    return { success: false, error: "Drive not connected. Please connect Google Drive or OneDrive." };
                }

                let driveItems: any[] = [];
                if (filter?.query) {
                    driveItems = await providers.drive.searchFiles(filter.query);
                } else {
                    driveItems = await providers.drive.listFolders(filter?.id || undefined);
                }

                return {
                    success: true,
                    data: driveItems.map((item: any) => ({
                        id: item.id,
                        title: item.name,
                        snippet: item.mimeType || "Folder",
                        date: item.createdAt,
                        source: "drive",
                        data: item
                    }))
                };

            case "approval":
                const emailAccount = await getEmailAccountWithAi({ emailAccountId });
                if (!emailAccount) return { success: false, error: "Email account not found" };

                const where: any = { userId: emailAccount.userId };
                if (filter?.status) {
                    where.status = filter.status;
                }

                const approvals = await prisma.approvalRequest.findMany({
                    where,
                    orderBy: { createdAt: "desc" },
                    take: limit
                });

                return {
                    success: true,
                    data: approvals.map((a: any) => ({
                        id: a.id,
                        title: a.externalContext?.summary || "Approval Request",
                        snippet: `Status: ${a.status}. ID: ${a.idempotencyKey}`,
                        date: a.createdAt,
                        source: "approval",
                        data: a
                    }))
                };

            case "calendar": {
                const calPrefs = await prisma.taskPreference.findUnique({
                    where: { userId },
                    select: { timeZone: true },
                });
                const calTz = calPrefs?.timeZone ?? "UTC";

                let calStart: Date;
                let calEnd: Date;

                if (filter?.dateRange?.after) {
                    calStart = new Date(filter.dateRange.after);
                } else {
                    const { toZonedTime, fromZonedTime } = await import("date-fns-tz");
                    const localNow = toZonedTime(new Date(), calTz);
                    const startOfDay = new Date(localNow);
                    startOfDay.setHours(0, 0, 0, 0);
                    calStart = fromZonedTime(startOfDay, calTz);
                }

                if (filter?.dateRange?.before) {
                    calEnd = new Date(filter.dateRange.before);
                } else {
                    const { toZonedTime, fromZonedTime } = await import("date-fns-tz");
                    const localNow = toZonedTime(new Date(), calTz);
                    const endOfDay = new Date(localNow);
                    endOfDay.setHours(23, 59, 59, 999);
                    calEnd = fromZonedTime(endOfDay, calTz);
                }

                const events = await providers.calendar.searchEvents(filter?.query || "", {
                    start: calStart,
                    end: calEnd,
                });
                const attendeeFilter = typeof filter?.attendeeEmail === "string"
                    ? filter.attendeeEmail.toLowerCase()
                    : null;
                const filteredEvents = attendeeFilter
                    ? events.filter((event: any) =>
                          event.attendees?.some(
                              (attendee: any) =>
                                  typeof attendee.email === "string" &&
                                  attendee.email.toLowerCase() === attendeeFilter,
                          ),
                      )
                    : events;
                const limitedEvents = filteredEvents.slice(0, limit);
                return {
                    success: true,
                    data: limitedEvents.map((e: any) => ({
                        id: e.id,
                        title: e.title || "(No Title)",
                        snippet: `Time: ${e.startTime} - ${e.endTime}. Attendees: ${e.attendees?.map((a: any) => a.email).join(", ")}`,
                        date: e.startTime,
                        source: "calendar"
                    })),
                    message: limitedEvents.length === 0 ? "No events in that range." : "Here are your calendar events.",
                };
            }

            case "task":
                const taskWhere: any = { userId };
                if (filter?.query) {
                    taskWhere.OR = [
                        { title: { contains: filter.query, mode: "insensitive" } },
                        { description: { contains: filter.query, mode: "insensitive" } },
                    ];
                }
                const tasks = await prisma.task.findMany({
                    where: taskWhere,
                    orderBy: { updatedAt: "desc" },
                    take: limit
                });
                return {
                    success: true,
                    data: tasks.map((t: any) => ({
                        id: t.id,
                        title: t.title,
                        snippet: t.description || "",
                        date: t.updatedAt,
                        source: "task",
                        data: t
                    }))
                };

            case "automation":
                const rules = await providers.automation.listRules();
                return {
                    success: true,
                    data: rules.map((r: any) => ({
                        id: r.id,
                        title: r.name,
                        snippet: `Enabled: ${r.enabled}. Actions: ${r.actions?.map((a: any) => a.type).join(", ")}`,
                        date: r.updatedAt,
                        source: "automation"
                    }))
                };

            case "knowledge":
                const knowledges = await providers.automation.listKnowledge();
                return {
                    success: true,
                    data: knowledges.map((k: any) => ({
                        id: k.id,
                        title: k.title,
                        snippet: k.content.substring(0, 150),
                        date: k.updatedAt,
                        source: "knowledge"
                    }))
                };

            case "report":
                const report = await providers.automation.generateReport();
                return {
                    success: true,
                    data: [
                        {
                            id: "executive-summary",
                            title: "Executive Summary",
                            snippet: report.executiveSummary || "No summary generated",
                            source: "report",
                            data: report
                        },
                        {
                            id: "user-persona",
                            title: "User Persona",
                            snippet: JSON.stringify(report.userPersona, null, 2),
                            source: "report"
                        }
                    ]
                };

            case "patterns":
                if (!filter?.id) return { success: false, error: "ID is required for patterns" };
                const matchResult = await providers.automation.matchRules(filter.id);
                return {
                    success: true,
                    data: matchResult.matches.map((m: any) => {
                        return {
                            id: m.rule.id,
                            title: m.rule.name,
                            snippet: `Match Reason: ${m.matchReasons?.map((r: any) => r.type).join(", ")}. Instructions: ${m.rule.instructions}`,
                            source: "patterns",
                            data: {
                                rule: m.rule,
                                reasons: m.matchReasons,
                                reasoning: matchResult.reasoning
                            }
                        };
                    })
                };

            case "contacts":
                try {
                    const contacts = await providers.email.searchContacts(filter?.query || "");
                    return {
                        success: true,
                        data: contacts.map((c: any) => ({
                            id: c.id,
                            title: c.name,
                            snippet: `Email: ${c.email || "N/A"}. Phone: ${c.phone || "N/A"}. Company: ${c.company || "N/A"}`,
                            source: "contacts",
                            data: c
                        }))
                    };
                } catch (contactErr: unknown) {
                    const msg = contactErr instanceof Error ? contactErr.message : String(contactErr);
                    return { success: false, error: `Contacts search failed: ${msg}` };
                }

            case "notification": {
                const notifType = filter?.type?.toLowerCase();
                const validNotifTypes = ["info", "warning", "success", "error"] as const;
                const notifications = await prisma.inAppNotification.findMany({
                    where: {
                        userId,
                        ...(notifType && validNotifTypes.includes(notifType as (typeof validNotifTypes)[number])
                            ? { type: notifType }
                            : {}),
                        ...(filter?.query ? {
                            OR: [
                                { title: { contains: filter.query, mode: "insensitive" } },
                                { body: { contains: filter.query, mode: "insensitive" } },
                            ],
                        } : {}),
                    },
                    orderBy: { createdAt: "desc" },
                    take: limit,
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
                return {
                    success: true,
                    data: notifications,
                    message: notifications.length === 0
                        ? "No notifications found."
                        : `Found ${notifications.length} notification(s).`,
                };
            }

            case "draft": {
                if (!providers.email) {
                    return { success: false, error: "Email provider not available" };
                }
                try {
                    const drafts = await providers.email.getDrafts({
                        maxResults: limit,
                    });
                    const normalizedDraftQuery = filter?.query?.toLowerCase().trim();
                    const filteredDrafts = normalizedDraftQuery
                        ? drafts.filter((d: any) => {
                              const subject = d.headers?.subject?.toLowerCase() ?? "";
                              const body = d.textPlain?.toLowerCase() ?? "";
                              const from = d.headers?.from?.toLowerCase() ?? "";
                              return (
                                  subject.includes(normalizedDraftQuery) ||
                                  body.includes(normalizedDraftQuery) ||
                                  from.includes(normalizedDraftQuery)
                              );
                          })
                        : drafts;
                    return {
                        success: true,
                        data: filteredDrafts.map((d: any) => ({
                            id: d.id,
                            subject: d.headers?.subject || "(No subject)",
                            snippet: d.textPlain?.substring(0, 200) || "",
                            from: d.headers?.from,
                            date: d.date,
                        })),
                        message: filteredDrafts.length === 0
                            ? "No drafts found."
                            : `Found ${filteredDrafts.length} draft(s).`,
                    };
                } catch (draftErr: unknown) {
                    const msg = draftErr instanceof Error ? draftErr.message : String(draftErr);
                    return { success: false, error: `Draft listing failed: ${msg}` };
                }
            }

            case "conversation": {
                const conversations = await prisma.conversation.findMany({
                    where: {
                        userId,
                        ...(filter?.query ? {
                            messages: {
                                some: {
                                    content: { contains: filter.query, mode: "insensitive" },
                                },
                            },
                        } : {}),
                    },
                    orderBy: { updatedAt: "desc" },
                    take: limit,
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
                return {
                    success: true,
                    data: conversations.map((c) => ({
                        id: c.id,
                        provider: c.provider,
                        updatedAt: c.updatedAt,
                        recentMessages: c.messages,
                    })),
                    message: conversations.length === 0
                        ? "No conversations found."
                        : `Found ${conversations.length} conversation(s).`,
                };
            }

            case "preferences": {
                const emailAccount = await prisma.emailAccount.findFirst({
                    where: { userId },
                    select: {
                        about: true,
                        statsEmailFrequency: true,
                        summaryEmailFrequency: true,
                    },
                });
                const taskPreference = await prisma.taskPreference.findUnique({
                    where: { userId },
                    select: {
                        workHourStart: true,
                        workHourEnd: true,
                        workDays: true,
                        bufferMinutes: true,
                        timeZone: true,
                    },
                });
                return {
                    success: true,
                    data: {
                        email: emailAccount,
                        scheduling: taskPreference,
                    },
                    message: "Current preferences loaded.",
                };
            }

            default:
                return { success: false, error: `Resource ${resource} not supported yet` };
        }
    },

    securityLevel: "SAFE",
};
