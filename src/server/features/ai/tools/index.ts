import { tool, zodSchema, type Schema } from "ai";
import { type z } from "zod";
import { type Logger } from "@/server/lib/logger";
import { type EmailAccount } from "@/features/ai/tools/providers/email";
import { createEmailProvider } from "./providers/email";
import { createCalendarProvider } from "./providers/calendar";
import { createAutomationProvider } from "./providers/automation";
import { createToolDriveProvider } from "./providers/drive";
import { type ToolContext, type ToolDefinition } from "./types";
import { executeTool } from "./executor";

import { queryTool } from "./query";
import { getTool } from "./get";
import { modifyTool } from "./modify";
import { createTool } from "./create";
import { deleteTool } from "./delete";
import { analyzeTool } from "./analyze";
import { triageTool } from "./triage";
import { rulesTool } from "./rules";
import { sendTool } from "./send";

export async function createAgentTools({
    emailAccount,
    logger,
    userId
}: {
    emailAccount: EmailAccount;
    logger: Logger;
    userId: string;
}) {
    // Initialize Providers
    const emailProvider = await createEmailProvider(emailAccount, logger);
    const calendarProvider = await createCalendarProvider(
        emailAccount,
        userId,
        logger,
    );
    const automationProvider = await createAutomationProvider(userId, logger);

    // Drive might fail if not connected
    let driveProvider;
    try {
        driveProvider = await createToolDriveProvider(emailAccount.id, logger);
    } catch (e) {
        logger.warn("Drive not connected or failed to initialize", { error: e });
    }

    const context: ToolContext = {
        userId,
        emailAccountId: emailAccount.id,
        logger,
        providers: {
            email: emailProvider,
            calendar: calendarProvider,
            automation: automationProvider,
            drive: driveProvider
        }
    };

    // Bind tools to context
    // We return a map of toolName -> Zod-friendly tool definition compatible with Vercel AI SDK or generic agents
    // But wait, standard Vercel AI SDK tools usually expect { description, parameters, execute }
    // Our `executeTool` takes the definition and params.
    // We should return implementations that call `executeTool`.

    const wrap = (def: ToolDefinition<any>) => {
        const schema = zodSchema(def.parameters);
        return tool({
            description: def.description,
            parameters: schema,
            // @ts-expect-error Zod v4 vs v3 mismatch causes overload resolution failure
            execute: async (params: any) => {
                return await executeTool(def, params, context);
            }
        });
    };

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
    };
}
