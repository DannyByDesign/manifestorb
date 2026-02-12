
import { z } from "zod";
import { type ToolDefinition } from "./types";
import prisma from "@/server/db/client";
import { getEmailAccountWithAi } from "@/server/lib/user/get";
import { aiGenerateMeetingBriefing } from "@/features/meeting-briefs/ai/generate-briefing";
import { gatherContextForEvent } from "@/features/meeting-briefs/gather-context";
import { createCalendarEventProviders } from "@/features/calendar/event-provider";
import { aiCategorizeSenders } from "@/features/categorize/ai/ai-categorize-senders";
import { aiClean } from "@/features/clean/ai/ai-clean";
import { aiDetectRecurringPattern } from "@/features/rules/ai/ai-detect-recurring-pattern";
import { formatDateTimeForUser } from "./timezone";
import { resolveCalendarTimeRange } from "./calendar-time";

const analyzeOptionsSchema = z.object({
    dateRange: z.object({
        after: z.string().optional(),
        before: z.string().optional(),
    }).optional(),
    timeZone: z.string().optional().describe("IANA timezone for interpreting dateRange and formatting suggested times."),
    durationMinutes: z.number().int().min(5).max(480).optional(),
    limit: z.number().int().min(1).max(10).optional(),
}).optional();

const analyzeParameters = z.discriminatedUnion("resource", [
    z.object({
        resource: z.literal("email"),
        ids: z.array(z.string()).optional(),
        analysisType: z.enum(["summarize", "extract_actions", "categorize", "clean_suggestions"]),
        options: analyzeOptionsSchema,
    }),
    z.object({
        resource: z.literal("calendar"),
        ids: z.array(z.string()).optional(),
        analysisType: z.enum(["find_conflicts", "suggest_times", "briefing"]),
        options: analyzeOptionsSchema,
    }),
    z.object({
        resource: z.literal("patterns"),
        ids: z.array(z.string()).optional(),
        analysisType: z.literal("detect_patterns"),
        options: analyzeOptionsSchema,
    }),
    z.object({
        resource: z.literal("automation"),
        ids: z.array(z.string()).optional(),
        analysisType: z.literal("assess_risk"),
        options: analyzeOptionsSchema,
    }),
]);

export const analyzeTool: ToolDefinition<typeof analyzeParameters> = {
    name: "analyze",
    description: `AI-powered analysis of items. Read-only, safe operation.
    
Email analysis:
- summarize: Summarize email thread
- extract_actions: Extract action items and todos
- categorize: Categorize sender/email type

Calendar analysis:
- find_conflicts: Find scheduling conflicts
- suggest_times: Suggest available meeting times (optionally in a specified IANA timezone)

Pattern analysis:
- detect_patterns: Analyze emails to suggest automation rules`,

    parameters: analyzeParameters,

    execute: async ({ resource, ids, analysisType, options }, { emailAccountId, logger, providers }) => {
        const emailAccount = await getEmailAccountWithAi({ emailAccountId });
        if (!emailAccount || !emailAccount.account) {
            return { success: false, error: "Email account not found or missing provider connection" };
        }

        switch (resource) {
            case "email":
                if (!ids || ids.length === 0) return { success: false, error: "No IDs provided" };

                if (analysisType === "clean_suggestions") {
                    const messages = await providers.email.get(ids);
                    if (messages.length === 0) return { success: false, error: "Message not found" };

                    const { getEmailForLLM } = await import("@/server/lib/get-email-from-message");
                    const llmMessages = messages.map(m => getEmailForLLM(m));

                    const result = await aiClean({
                        emailAccount,
                        messageId: ids[0],
                        messages: llmMessages,
                        skips: { reply: true, receipt: true }
                    });
                    return { success: true, data: result };

                } else if (analysisType === "categorize") {
                    const messages = await providers.email.get(ids);
                    if (messages.length === 0) return { success: false, error: "Messages not found" };

                    const categories = await prisma.category.findMany({
                        where: { emailAccountId },
                        select: { name: true, description: true }
                    });

                    const sendersMap = new Map<string, { subject: string; snippet: string }[]>();
                    for (const m of messages) {
                        const emailAddress = m.headers.from; // ParsedMessage headers.from is string
                        if (!sendersMap.has(emailAddress)) sendersMap.set(emailAddress, []);
                        sendersMap.get(emailAddress)?.push({
                            subject: m.headers.subject,
                            snippet: m.snippet || m.textPlain?.substring(0, 100) || ""
                        });
                    }

                    const sendersInput = Array.from(sendersMap.entries()).map(([email, emails]) => ({
                        emailAddress: email,
                        emails
                    }));

                    const results = await aiCategorizeSenders({
                        emailAccount,
                        senders: sendersInput,
                        categories
                    });
                    return { success: true, data: results };
                }

                return {
                    success: true,
                    data: {
                        message: "Analysis requested. Retrieve full content using 'get' to perform analysis, or implement backend summarization service.",
                        ids
                    }
                };

            case "calendar":
                if (analysisType === "briefing") {
                    if (!ids || ids.length === 0) return { success: false, error: "Event ID required for briefing" };
                    const eventId = ids[0];

                    // Fetch calendar providers
                    const calendarProviders = await createCalendarEventProviders(emailAccountId, logger);

                    let event = null;
                    for (const provider of calendarProviders) {
                        try {
                            event = await provider.getEvent(eventId);
                            if (event) break;
                        } catch (e) {
                            logger.warn("Failed to fetch event from provider", { error: e });
                        }
                    }

                    if (!event) return { success: false, error: "Event not found" };

                    // Gather Context
                    const briefingData = await gatherContextForEvent({
                        event,
                        emailAccountId,
                        userEmail: emailAccount.email,
                        userDomain: emailAccount.email.split("@")[1] || "",
                        provider: emailAccount.account?.provider || "",
                        logger
                    });

                    if (!briefingData) return { success: false, error: "Could not gather briefing context" };

                    // Generate Briefing
                    const briefing = await aiGenerateMeetingBriefing({
                        briefingData,
                        emailAccount,
                        logger
                    });

                    return { success: true, data: briefing };
                }
                if (analysisType === "find_conflicts") {
                    if (!providers.calendar) {
                        return { success: false, error: "Calendar provider not available" };
                    }
                    if (!ids || ids.length === 0) {
                        return { success: false, error: "Event IDs required for conflict detection" };
                    }

                    const conflicts = [];
                    for (const id of ids) {
                        const event = await providers.calendar.getEvent({ eventId: id });
                        if (!event) continue;

                        const range = {
                            start: event.startTime,
                            end: event.endTime,
                        };
                        const eventsInRange = await providers.calendar.searchEvents("", range);
                        const overlapping = eventsInRange.filter((candidate) => {
                            if (candidate.id === event.id) return false;
                            return (
                                candidate.startTime < event.endTime &&
                                event.startTime < candidate.endTime
                            );
                        });

                        conflicts.push({
                            event: {
                                id: event.id,
                                title: event.title,
                                startTime: event.startTime,
                                endTime: event.endTime,
                                eventUrl: event.eventUrl,
                            },
                            conflicts: overlapping.map((item) => ({
                                id: item.id,
                                title: item.title,
                                startTime: item.startTime,
                                endTime: item.endTime,
                                eventUrl: item.eventUrl,
                            })),
                        });
                    }

                    return { success: true, data: { conflicts } };
                }
                if (analysisType === "suggest_times") {
                    if (!providers.calendar) {
                        return { success: false, error: "Calendar provider not available" };
                    }
                    const range = await resolveCalendarTimeRange({
                        userId: emailAccount.userId,
                        emailAccountId,
                        requestedTimeZone: options?.timeZone,
                        dateRange: options?.dateRange,
                        defaultWindow: "next_7_days",
                        missingBoundDurationMs: 7 * 24 * 60 * 60 * 1000,
                    });
                    if ("error" in range) {
                        return { success: false, error: range.error };
                    }
                    const durationMinutes = options?.durationMinutes ?? 30;
                    const limit = options?.limit ?? 3;

                    const slots = await providers.calendar.findAvailableSlots({
                        durationMinutes,
                        start: range.start,
                        end: range.end,
                    });
                    return {
                        success: true,
                        data: {
                            suggestedTimes: slots.slice(0, limit).map((slot) => ({
                                start: slot.start.toISOString(),
                                end: slot.end.toISOString(),
                                localStart: formatDateTimeForUser(slot.start, range.timeZone),
                                localEnd: formatDateTimeForUser(slot.end, range.timeZone),
                                timeZone: range.timeZone,
                                score: slot.score,
                            })),
                        },
                    };
                }
                return { success: false, error: "Unsupported calendar analysis request" };

            case "patterns":
                if (analysisType === "detect_patterns") {
                    if (!ids || ids.length === 0) return { success: false, error: "Message ID required for pattern detection" };

                    const messages = await providers.email.get(ids);
                    if (messages.length === 0) return { success: false, error: "Message not found" };

                    const { getEmailForLLM } = await import("@/server/lib/get-email-from-message");
                    const llmMessages = messages.map(m => getEmailForLLM(m));

                    const rules = await prisma.rule.findMany({
                        where: { emailAccountId, enabled: true, instructions: { not: null } },
                        select: { name: true, instructions: true }
                    });

                    const safeRules = rules.map(r => ({ name: r.name, instructions: r.instructions || "" }));

                    const result = await aiDetectRecurringPattern({
                        emails: llmMessages,
                        emailAccount,
                        rules: safeRules,
                        logger
                    });

                    return { success: true, data: result };
                }
                return { success: false, error: "Unsupported pattern analysis request" };

            case "automation":
                if (analysisType === "assess_risk") {
                    if (!ids || ids.length === 0) return { success: false, error: "Rule ID required for risk assessment" };

                    const rule = await prisma.rule.findUnique({
                        where: { id: ids[0], emailAccountId },
                        include: { actions: true }
                    });

                    if (!rule) return { success: false, error: "Rule not found" };

                    const { getRiskLevel } = await import("@/server/lib/risk");
                    const risk = getRiskLevel(rule);

                    return { success: true, data: risk };
                }
                return { success: false, error: "Unsupported automation analysis request" };

            default:
                return { success: false, error: `Resource ${resource} not supported` };
        }
    },

    securityLevel: "SAFE",
};
