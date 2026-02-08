import { type z } from "zod";
import { getErrorMessage } from "@/server/lib/error";
import { type ToolDefinition, type ToolContext, type ToolResult } from "./types";
import { checkPermissions, checkRateLimit, applyScopeLimits } from "./security";
import { auditLog } from "./audit";

function inferItemCount(data: unknown): number | undefined {
    if (Array.isArray(data)) return data.length;
    if (data && typeof data === "object" && "count" in data) {
        const count = (data as { count?: unknown }).count;
        if (typeof count === "number") return count;
    }
    return undefined;
}

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

        // 2. Check permissions first (invalid requests should not consume rate-limit budget)
        await checkPermissions(context.userId, toolName, validated);

        // 3. Apply scope limits
        const limited = applyScopeLimits(toolName, validated);

        // 4. Check rate limits after validation and guardrails
        await checkRateLimit(context.userId, toolName);

        // 5. Execute tool
        const result = await tool.execute(limited, context);
        const durationMs = Date.now() - startTime;
        const resource = typeof (limited as { resource?: unknown }).resource === "string"
            ? String((limited as { resource?: unknown }).resource)
            : undefined;
        const requestedIds = Array.isArray((limited as { ids?: unknown }).ids)
            ? ((limited as { ids?: unknown }).ids as unknown[]).filter((v): v is string => typeof v === "string")
            : undefined;
        const itemCount = result.meta?.itemCount ?? inferItemCount(result.data);
        const enrichedResult: ToolResult = {
            ...result,
            meta: {
                ...result.meta,
                ...(resource ? { resource } : {}),
                ...(requestedIds ? { requestedIds } : {}),
                ...(itemCount !== undefined ? { itemCount } : {}),
                durationMs,
            },
        };

        // 6. Audit log
        await auditLog(
            {
                timestamp: new Date(),
                userId: context.userId,
                emailAccountId: context.emailAccountId,
                tool: toolName,
                params: limited, // Log the limited/sanitized params
                success: true,
                durationMs,
            },
            context
        );

        return enrichedResult;

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
