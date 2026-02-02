import { type z } from "zod";
import { type ToolDefinition, type ToolContext, type ToolResult } from "./types";
import { checkPermissions, checkRateLimit, applyScopeLimits } from "./security";
import { auditLog } from "./audit";

export async function executeTool<T extends z.ZodType>(
    tool: ToolDefinition<T>,
    params: unknown,
    context: ToolContext
): Promise<ToolResult> {
    const startTime = Date.now();
    const toolName = tool.name;

    try {
        // 1. Validate params
        // Zod parse will throw if invalid
        const validated = tool.parameters.parse(params);

        // 2. Check rate limits
        await checkRateLimit(context.userId, toolName);

        // 3. Check permissions
        await checkPermissions(context.userId, toolName, validated);

        // 4. Apply scope limits
        const limited = applyScopeLimits(validated);

        // 5. Execute tool
        const result = await tool.execute(limited, context);

        // 6. Audit log
        await auditLog(
            {
                timestamp: new Date(),
                userId: context.userId,
                emailAccountId: context.emailAccountId,
                tool: toolName,
                params: limited, // Log the limited/sanitized params
                success: true,
                durationMs: Date.now() - startTime,
            },
            context
        );

        return result;

    } catch (error: any) {
        // 6. Audit log (failure)
        await auditLog(
            {
                timestamp: new Date(),
                userId: context.userId,
                emailAccountId: context.emailAccountId,
                tool: toolName,
                params: params, // Log original params if validation/limiting failed
                success: false,
                error: error.message || String(error),
                durationMs: Date.now() - startTime,
            },
            context
        );

        // Re-throw or return error result?
        // The plan implies throwing, but returning a ToolResult with error is often easier for the Agent to handle.
        // However, the `executeTool` signature returns `Promise<ToolResult>`.
        // If we throw, the generic tool calling loop needs to catch it.
        // Let's return a clean error result so the Agent sees it as a tool output.

        return {
            success: false,
            error: error.message || "Unknown error occurred",
            meta: {
                durationMs: Date.now() - startTime,
            }
        };
    }
}
