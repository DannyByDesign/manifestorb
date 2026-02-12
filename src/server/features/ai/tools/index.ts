import { tool, zodSchema } from "ai";
import { z } from "zod";
import { google } from "@ai-sdk/google";
import { type Logger } from "@/server/lib/logger";
import { type ToolEmailAccount } from "@/features/ai/tools/providers/types";
import { createEmailProvider } from "./providers/email";
import { createCalendarProvider } from "./providers/calendar";
import { createAutomationProvider } from "./providers/automation";
import { type AutomationProvider } from "./providers/automation";
import { type ToolContext, type ToolDefinition } from "./types";
import { executeTool } from "./executor";
import { createGenerateText } from "@/server/lib/llms";
import { getModel } from "@/server/lib/llms/model";

import { queryTool } from "./query";
import { getTool } from "./get";
import { modifyTool } from "./modify";
import { createTool } from "./create";
import { deleteTool } from "./delete";
import { analyzeTool } from "./analyze";
import { triageTool } from "./triage";
import { rulesTool } from "./rules";
import { sendTool } from "./send";
import { workflowTool } from "./workflow";

function createUnavailableAutomationProvider(reason: string): AutomationProvider {
    const fail = async () => {
        throw new Error(reason);
    };
    return {
        listRules: async () => [],
        createRule: fail,
        updateRule: fail,
        deleteRule: fail,
        deleteTemporaryRulesByName: fail,
        listKnowledge: async () => [],
        createKnowledge: fail,
        deleteKnowledge: fail,
        generateReport: fail,
        unsubscribe: async () => ({ success: false, error: reason }),
        matchRules: async () => ({ matches: [], reasoning: reason }),
    };
}

export async function createAgentTools({
    emailAccount,
    logger,
    userId,
    toolContext,
}: {
    emailAccount: ToolEmailAccount;
    logger: Logger;
    userId: string;
    toolContext?: {
        conversationId?: string;
        sourceEmailMessageId?: string;
        sourceEmailThreadId?: string;
        currentMessage?: string;
    };
}) {
    // Initialize Providers
    const emailProvider = await createEmailProvider(emailAccount, logger);
    const calendarProvider = await createCalendarProvider(
        emailAccount,
        userId,
        logger,
    );
    let automationProvider: AutomationProvider;
    let automationAvailable = true;
    try {
        automationProvider = await createAutomationProvider(userId, logger);
    } catch (e) {
        automationAvailable = false;
        const message = e instanceof Error ? e.message : "Automation provider unavailable";
        logger.warn("Automation provider failed to initialize; using degraded fallback", { error: e });
        automationProvider = createUnavailableAutomationProvider(message);
    }

    logger.info("AI tool provider capabilities", {
        email: true,
        calendar: true,
        automation: automationAvailable,
    });

    const context: ToolContext = {
        userId,
        emailAccountId: emailAccount.id,
        emailMessageId: toolContext?.sourceEmailMessageId,
        emailThreadId: toolContext?.sourceEmailThreadId,
        conversationId: toolContext?.conversationId,
        currentMessage: toolContext?.currentMessage,
        logger,
        providers: {
            email: emailProvider,
            calendar: calendarProvider,
            automation: automationProvider,
        }
    };

    // Bind tools to context
    // We return a map of toolName -> Zod-friendly tool definition compatible with Vercel AI SDK or generic agents
    // But wait, standard Vercel AI SDK tools usually expect { description, parameters, execute }
    // Our `executeTool` takes the definition and params.
    // We should return implementations that call `executeTool`.

    const wrap = <T extends z.ZodTypeAny>(def: ToolDefinition<T>) => {
        const schema = zodSchema(def.parameters);
        return tool({
            description: def.description,
            parameters: schema,
            // @ts-expect-error Zod v4 vs v3 mismatch causes overload resolution failure
            execute: async (params: unknown) => {
                return await executeTool(def, params, context);
            }
        });
    };

    const modelOptions = getModel("economy");
    const webSearchGenerateText = createGenerateText({
        emailAccount: {
            id: emailAccount.id,
            email: emailAccount.email,
            userId,
        },
        label: "Web Search",
        modelOptions,
    });
    const webSearchTool = tool({
        description:
            "Search the web for information about a person, company, or topic. Use for meeting prep, research, or when the user asks about external information.",
        parameters: zodSchema(z.object({
            query: z.string().describe("The search query"),
        })),
        // @ts-expect-error AI SDK tool overload typing mismatch with local zod schema helper
        execute: async ({ query }: { query: string }) => {
            const searchTools = google.tools.googleSearch({});
            const result = await webSearchGenerateText({
                ...modelOptions,
                prompt: query,
                tools: { google_search: searchTools },
            });
            return { success: true, data: result.text };
        },
    });

    return {
        query: wrap(queryTool),
        get: wrap(getTool),
        modify: wrap(modifyTool),
        create: wrap(createTool),
        delete: wrap(deleteTool),
        analyze: wrap(analyzeTool),
        triage: wrap(triageTool),
        rules: wrap(rulesTool),
        send: wrap(sendTool),
        workflow: wrap(workflowTool),
        webSearch: webSearchTool,
    };
}
