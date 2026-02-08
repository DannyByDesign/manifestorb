import { type z } from "zod";
import { getErrorMessage } from "@/server/lib/error";
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

    } catch (error: unknown) {
        const message = (getErrorMessage(error) ?? String(error)) || "Unknown error";
        // Log full error for debugging (stack, cause, etc.) so we can find root cause
        context.logger?.error?.("Tool execution failed", {
            tool: toolName,
            errorMessage: message,
            error: error instanceof Error ? { name: error.name, message: error.message, stack: error.stack, cause: error.cause } : error,
        });

        // 6. Audit log (failure)
        await auditLog(
            {
                timestamp: new Date(),
                userId: context.userId,
                emailAccountId: context.emailAccountId,
                tool: toolName,
                params: params, // Log original params if validation/limiting failed
                success: false,
                error: message,
                durationMs: Date.now() - startTime,
            },
            context
        );

        return {
            success: false,
            error: message,
            meta: {
                durationMs: Date.now() - startTime,
            }
        };
    }
}
