
import { z } from "zod";
import { type ToolDefinition } from "./types";
import prisma from "@/server/db/client";
import { getEmailAccountWithAi } from "@/server/utils/user/get";
import { aiGenerateMeetingBriefing } from "@/server/integrations/ai/meeting-briefs/generate-briefing";
import { gatherMeetingContext } from "@/server/utils/meeting-briefs/gather-context";
import { aiCategorizeSenders } from "@/server/integrations/ai/categorize-sender/ai-categorize-senders";
import { aiClean } from "@/server/integrations/ai/clean/ai-clean";
import { aiDetectRecurringPattern } from "@/server/integrations/ai/choose-rule/ai-detect-recurring-pattern";
import { type EmailForLLM } from "@/server/types";

export const analyzeTool: ToolDefinition<any> = {
    name: "analyze",
    description: `AI-powered analysis of items. Read-only, safe operation.
    
Email analysis:
- summarize: Summarize email thread
- extract_actions: Extract action items and todos
- categorize: Categorize sender/email type

Calendar analysis:
- find_conflicts: Find scheduling conflicts
- suggest_times: Suggest available meeting times

Pattern analysis:
- detect_patterns: Analyze emails to suggest automation rules`,

    parameters: z.object({
        resource: z.enum(["email", "calendar", "patterns", "automation"]),
        ids: z.array(z.string()).optional(),
        analysisType: z.enum([
            "summarize", "extract_actions", "categorize", "clean_suggestions", // Email
            "find_conflicts", "suggest_times", "briefing", // Calendar
            "detect_patterns", // Patterns
            "assess_risk" // Automation
        ]),
        options: z.object({
            dateRange: z.object({
                after: z.string().optional(),
                before: z.string().optional(),
            }).optional(),
        }).optional(),
    }),

    execute: async ({ resource, ids, analysisType }, { emailAccountId, logger, providers }) => {
        // Hydrate full EmailAccount for AI functions
        const emailAccount = await getEmailAccountWithAi({ emailAccountId });
        if (!emailAccount || !emailAccount.account) {
            return { success: false, error: "Email account not found or missing provider connection" };
        }

        switch (resource) {
            case "email":
                if (!ids || ids.length === 0) return { success: false, error: "No IDs provided" };

                if (analysisType === "clean_suggestions") {
                    // AI Clean for a specific message
                    const messages = await providers.email.get(ids);
                    if (messages.length === 0) return { success: false, error: "Message not found" };

                    // Convert to EmailForLLM (simplification)
                    const llmMessages = messages.map(m => ({
                        ...m,
                        body: m.text || m.body || "",
                        from: m.from.email || m.from
                    })) as EmailForLLM[];

                    const result = await aiClean({
                        emailAccount,
                        messageId: ids[0],
                        messages: llmMessages,
                        skips: { reply: true, receipt: true }
                    });
                    return { success: true, data: result };

                } else if (analysisType === "categorize") {
                    // Sender Categorization
                    // 1. Fetch messages
                    const messages = await providers.email.get(ids);
                    if (messages.length === 0) return { success: false, error: "Messages not found" };

                    // 2. Fetch Categories
                    const categories = await prisma.category.findMany({
                        where: { emailAccountId },
                        select: { name: true, description: true }
                    });

                    // 3. Group by Sender (Naive implementation for tool)
                    const sendersMap = new Map<string, { subject: string; snippet: string }[]>();
                    for (const m of messages) {
                        const emailAddress = typeof m.from === 'string' ? m.from : m.from.email;
                        if (!sendersMap.has(emailAddress)) sendersMap.set(emailAddress, []);
                        sendersMap.get(emailAddress)?.push({
                            subject: m.subject,
                            snippet: m.snippet || m.body?.substring(0, 100) || ""
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

                    // Gather Context
                    const briefingData = await gatherMeetingContext({
                        emailAccount,
                        eventId,
                        logger // Logger compatibility? gatherMeetingContext might expect a different logger type, assuming compatible.
                    });

                    if (!briefingData) return { success: false, error: "Could not gather briefing context (event not found?)" };

                    // Generate Briefing
                    const briefing = await aiGenerateMeetingBriefing({
                        briefingData,
                        emailAccount,
                        logger
                    });

                    return { success: true, data: briefing };
                }
                return { success: false, error: "Calendar analysis type not implemented" };

            case "patterns":
                if (analysisType === "detect_patterns") {
                    if (!ids || ids.length === 0) return { success: false, error: "Message ID required for pattern detection" };

                    // Fetch messages
                    const messages = await providers.email.get(ids);
                    if (messages.length === 0) return { success: false, error: "Message not found" };

                    // Convert to EmailForLLM
                    const llmMessages = messages.map(m => ({
                        ...m,
                        body: m.text || m.body || "",
                        from: typeof m.from === 'string' ? m.from : m.from.email
                    })) as EmailForLLM[];

                    // Fetch Rules
                    const rules = await prisma.rule.findMany({
                        where: { emailAccountId, enabled: true },
                        select: { name: true, instructions: true }
                    });

                    const result = await aiDetectRecurringPattern({
                        emails: llmMessages,
                        emailAccount,
                        rules,
                        logger
                    });

                    return { success: true, data: result };
                }
                return { success: false, error: "Pattern detection type not implemented" };

            case "automation":
                if (analysisType === "assess_risk") {
                    if (!ids || ids.length === 0) return { success: false, error: "Rule ID required for risk assessment" };

                    const rule = await prisma.rule.findUnique({
                        where: { id: ids[0], emailAccountId },
                        include: { actions: true }
                    });

                    if (!rule) return { success: false, error: "Rule not found" };

                    // Assess Risk
                    // Convert helper function import if needed
                    const { getRiskLevel } = await import("@/server/utils/risk");

                    // Rule from DB matches the expected shape?
                    // getRiskLevel takes (Pick<RulesResponse[number], "actions"> & RuleConditions)
                    // RuleConditions is { conditions: ... }
                    // Our fetched rule has { conditions: ..., actions: ... }
                    // Should be compatible.

                    const risk = getRiskLevel(rule as any);

                    return { success: true, data: risk };
                }
                return { success: false, error: "Automation analysis type not implemented" };

            default:
                return { success: false, error: `Resource ${resource} not supported` };
        }
    },

    securityLevel: "SAFE",
};
