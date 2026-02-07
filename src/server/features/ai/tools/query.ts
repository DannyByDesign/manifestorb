
import { z } from "zod";
import { type ToolDefinition } from "./types";
import prisma from "@/server/db/client";
import { getEmailAccountWithAi } from "@/server/lib/user/get";

export const queryTool: ToolDefinition<any> = {
    name: "query",
    description: `Search and retrieve items from any resource.

Resources:
- email: Search emails (supports Gmail/Outlook query syntax)
- calendar: Search events by date range, attendees, title
- task: Search tasks by title/description
- automation: List rules and their configurations
- notification: Search notifications by title/body, filter by type
- draft: List email drafts, optionally filter by query
- conversation: Search conversation history across all platforms
- preferences: Read current email and scheduling preferences`,

    parameters: z.object({
        resource: z.enum([
            "email", "calendar", "drive", "automation", "knowledge", "report", "patterns", "contacts", "task",
            "notification", "draft", "conversation", "preferences"
        ]),
        filter: z.preprocess(
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
            z
                .object({
                    query: z.string().optional(),
                    id: z.string().optional(),
                    dateRange: z
                        .object({
                            after: z.string().optional(),
                            before: z.string().optional(),
                        })
                        .optional(),
                    limit: z.number().max(50).default(20),
                    status: z.enum(["PENDING", "APPROVED", "DENIED", "EXPIRED", "CANCELLED"]).optional(),
                    type: z.string().optional(),
                })
                .optional(),
        ),
    }),

    execute: async ({ resource, filter }, { emailAccountId, providers, userId }) => {
        const limit = filter?.limit || 20;

        switch (resource) {
            case "email":
                const emails = await providers.email.search(filter?.query || "", limit);
                // Map to DomainObjectRef (Summary)
                return {
                    success: true,
                    data: emails.map((e: any) => ({
                        id: e.id,
                        title: e.subject || "(No Subject)",
                        snippet: e.snippet || e.body?.substring(0, 150) || "",
                        date: e.date,
                        source: "email",
                        from: e.from
                    })),
                };

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

            case "calendar":
                const events = await providers.calendar.searchEvents(filter?.query || "", {
                    start: filter?.dateRange?.after ? new Date(filter.dateRange.after) : new Date(),
                    end: filter?.dateRange?.before ? new Date(filter.dateRange.before) : new Date(Date.now() + 86400000)
                });
                return {
                    success: true,
                    data: events.map((e: any) => ({
                        id: e.id,
                        title: e.title || "(No Title)",
                        snippet: `Time: ${e.startTime} - ${e.endTime}. Attendees: ${e.attendees?.map((a: any) => a.email).join(", ")}`,
                        date: e.startTime,
                        source: "calendar"
                    })),
                    message: events.length === 0 ? "No events in that range." : "Here are your calendar events.",
                };

            case "task":
                const taskWhere: any = {};
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
                const drafts = await providers.email.getDrafts({
                    maxResults: limit,
                });
                return {
                    success: true,
                    data: drafts.map((d: any) => ({
                        id: d.id,
                        subject: d.headers?.subject || "(No subject)",
                        snippet: d.textPlain?.substring(0, 200) || "",
                        from: d.headers?.from,
                        date: d.date,
                    })),
                    message: drafts.length === 0
                        ? "No drafts found."
                        : `Found ${drafts.length} draft(s).`,
                };
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
