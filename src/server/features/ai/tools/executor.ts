import { z, type ZodType } from "zod";
import { getErrorMessage } from "@/server/lib/error";
import {
    genericRecoveryMessage,
    genericRecoveryPrompt,
    invalidFieldsPrompt,
    missingFieldsPrompt,
    parseFailurePrompt,
    permissionDeniedMessage,
    permissionDeniedPrompt,
    rateLimitedMessage,
    rateLimitedPrompt,
    resourceClarificationPrompt,
    unsupportedResourceMessage,
    unsupportedResourcePrompt,
} from "@/features/ai/conversational-copy";
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

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === "object" && value !== null;
}

function pickClarification(value: unknown): ToolResult["clarification"] | undefined {
    if (!isRecord(value)) return undefined;
    const kind = value.kind;
    const prompt = value.prompt;
    const missingFields = value.missingFields;
    if (typeof kind !== "string" || typeof prompt !== "string") return undefined;
    const normalizedKind = (
        kind === "resource" ||
        kind === "missing_fields" ||
        kind === "invalid_fields" ||
        kind === "permissions" ||
        kind === "rate_limit" ||
        kind === "other"
    )
        ? kind
        : "other";
    const normalizedMissingFields = Array.isArray(missingFields)
        ? missingFields.filter((field): field is string => typeof field === "string")
        : undefined;
    return {
        kind: normalizedKind,
        prompt,
        ...(normalizedMissingFields && normalizedMissingFields.length > 0
            ? { missingFields: normalizedMissingFields }
            : {}),
    };
}

function extractPayloadData(record: Record<string, unknown>): unknown {
    if ("data" in record) return record.data;

    const knownKeys = new Set([
        "success",
        "error",
        "message",
        "clarification",
        "interactive",
        "truncated",
        "paging",
        "meta",
    ]);
    const payloadEntries = Object.entries(record).filter(([key]) => !knownKeys.has(key));
    if (payloadEntries.length === 0) return undefined;
    return Object.fromEntries(payloadEntries);
}

function pickInteractive(value: unknown): ToolResult["interactive"] | undefined {
    if (!isRecord(value)) return undefined;
    const type = value.type;
    const summary = value.summary;
    const actions = value.actions;
    if (
        (type !== "approval_request" &&
            type !== "draft_created" &&
            type !== "action_request" &&
            type !== "ambiguous_time") ||
        typeof summary !== "string" ||
        !Array.isArray(actions)
    ) {
        return undefined;
    }
    const normalizedActions = actions
        .filter((action): action is Record<string, unknown> => isRecord(action))
        .map((action) => {
            const label = typeof action.label === "string" ? action.label : "";
            const style: "primary" | "danger" =
                action.style === "danger" ? "danger" : "primary";
            const value = typeof action.value === "string" ? action.value : "";
            const url = typeof action.url === "string" ? action.url : undefined;
            return {
                label,
                style,
                value,
                ...(url ? { url } : {}),
            };
        })
        .filter((action) => action.label.length > 0 && action.value.length > 0);
    if (normalizedActions.length === 0) return undefined;
    return {
        type,
        summary,
        actions: normalizedActions,
        ...(typeof value.approvalId === "string" ? { approvalId: value.approvalId } : {}),
        ...(typeof value.draftId === "string" ? { draftId: value.draftId } : {}),
        ...(typeof value.emailAccountId === "string" ? { emailAccountId: value.emailAccountId } : {}),
        ...(typeof value.userId === "string" ? { userId: value.userId } : {}),
        ...(typeof value.ambiguousRequestId === "string" ? { ambiguousRequestId: value.ambiguousRequestId } : {}),
        ...(isRecord(value.preview) ? { preview: value.preview as any } : {}),
        ...(isRecord(value.context) ? { context: value.context as any } : {}),
    };
}

function normalizeToolOutput(raw: unknown, toolName: string): ToolResult {
    if (!isRecord(raw)) {
        return { success: true, data: raw };
    }

    const explicitSuccess = typeof raw.success === "boolean" ? raw.success : undefined;
    const hasErrorText = typeof raw.error === "string" && raw.error.trim().length > 0;
    const success = explicitSuccess ?? !hasErrorText;
    const clarification = pickClarification(raw.clarification);
    const error = success
        ? undefined
        : (typeof raw.error === "string" && raw.error.trim().length > 0
            ? raw.error.trim()
            : "Tool execution failed.");
    const message = typeof raw.message === "string" && raw.message.trim().length > 0
        ? raw.message.trim()
        : (!success
            ? (clarification?.prompt ?? `I couldn't complete the ${toolName} action.`)
            : undefined);
    const paging = isRecord(raw.paging) ? raw.paging : undefined;
    const meta = isRecord(raw.meta) ? raw.meta as ToolResult["meta"] : undefined;
    const interactive = pickInteractive(raw.interactive);
    const data = extractPayloadData(raw);

    return {
        success,
        ...(data !== undefined ? { data } : {}),
        ...(error ? { error } : {}),
        ...(message ? { message } : {}),
        ...(clarification ? { clarification } : {}),
        ...(typeof raw.truncated === "boolean" ? { truncated: raw.truncated } : {}),
        ...(paging ? { paging } : {}),
        ...(meta ? { meta } : {}),
        ...(interactive ? { interactive } : {}),
    };
}

export async function executeTool<T extends ZodType>(
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
        await checkPermissions(context.userId, toolName, validated, {
            emailAccountId: context.emailAccountId,
        });

        // 3. Apply scope limits
        const limited = applyScopeLimits(
            toolName,
            validated as Record<string, unknown>,
        );

        // 4. Check rate limits after validation and guardrails
        await checkRateLimit(context.userId, toolName);

        // 5. Execute tool
        const rawResult = await tool.execute(limited as z.infer<T>, context);
        const result = normalizeToolOutput(rawResult, toolName);
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
                success: enrichedResult.success,
                ...(enrichedResult.success ? {} : { error: enrichedResult.error ?? "Tool execution failed." }),
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

        const recovery = buildFailureRecoveryHint({
            toolName,
            params,
            error,
            rawMessage: message,
        });

        return {
            success: false,
            error: recovery.error,
            message: recovery.message,
            clarification: recovery.clarification,
            meta: {
                durationMs: Date.now() - startTime,
            }
        };
    }
}

function buildFailureRecoveryHint(params: {
    toolName: string;
    params: unknown;
    error: unknown;
    rawMessage: string;
}): {
    error: string;
    message: string;
    clarification: ToolResult["clarification"];
} {
    const { toolName, error, rawMessage } = params;

    if (error instanceof z.ZodError) {
        const clarification = buildZodClarification(error, toolName);
        return {
            error: "Invalid tool arguments.",
            message: clarification.prompt,
            clarification,
        };
    }

    const normalized = rawMessage.toLowerCase();
    if (normalized.includes("resource") && normalized.includes("not allowed")) {
        return {
            error: "Unsupported resource for this action.",
            message: unsupportedResourceMessage(),
            clarification: {
                kind: "resource",
                prompt: unsupportedResourcePrompt(),
            },
        };
    }

    if (normalized.includes("forbidden")) {
        return {
            error: "Permission denied for requested items.",
            message: permissionDeniedMessage(),
            clarification: {
                kind: "permissions",
                prompt: permissionDeniedPrompt(),
            },
        };
    }

    if (normalized.includes("rate limit")) {
        return {
            error: "Rate limit reached.",
            message: rateLimitedMessage(),
            clarification: {
                kind: "rate_limit",
                prompt: rateLimitedPrompt(),
            },
        };
    }

    return {
        error: rawMessage,
        message: genericRecoveryMessage(),
        clarification: {
            kind: "other",
            prompt: genericRecoveryPrompt(),
        },
    };
}

function buildZodClarification(error: z.ZodError, toolName: string): NonNullable<ToolResult["clarification"]> {
    const missingFields = extractMissingFields(error.issues)
        .map(humanizeFieldPath)
        .filter((value, index, array) => array.indexOf(value) === index);
    const hasResourceDiscriminatorError = error.issues.some(
        (issue) =>
            issue.code === "invalid_union" &&
            "discriminator" in issue &&
            issue.discriminator === "resource",
    );

    if (hasResourceDiscriminatorError) {
        return {
            kind: "resource",
            prompt: resourceClarificationPrompt(toolName),
            missingFields: ["resource"],
        };
    }

    if (missingFields.length > 0) {
        const joined = missingFields.slice(0, 4).join(", ");
        return {
            kind: "missing_fields",
            prompt: missingFieldsPrompt(joined),
            missingFields,
        };
    }

    const invalidKeys = extractUnrecognizedKeys(error.issues);
    if (invalidKeys.length > 0) {
        return {
            kind: "invalid_fields",
            prompt: invalidFieldsPrompt(invalidKeys.join(", ")),
        };
    }

    return {
        kind: "other",
        prompt: parseFailurePrompt(),
    };
}

function extractMissingFields(issues: z.ZodIssue[]): string[] {
    const fields: string[] = [];
    for (const issue of issues) {
        const hasUndefinedInput = "input" in issue && issue.input === undefined;
        const hasUndefinedReceived =
            "received" in issue &&
            typeof issue.received === "string" &&
            issue.received === "undefined";
        const messageIndicatesUndefined = issue.message.toLowerCase().includes("received undefined");
        if (
            issue.code === "invalid_type" &&
            issue.expected &&
            (hasUndefinedInput || hasUndefinedReceived || messageIndicatesUndefined) &&
            issue.path.length > 0
        ) {
            fields.push(issue.path.join("."));
            continue;
        }

        if (
            issue.code === "too_small" &&
            issue.minimum === 1 &&
            issue.path.length > 0
        ) {
            fields.push(issue.path.join("."));
        }
    }
    return fields;
}

function extractUnrecognizedKeys(issues: z.ZodIssue[]): string[] {
    const keys: string[] = [];
    for (const issue of issues) {
        if (issue.code === "unrecognized_keys") {
            keys.push(...issue.keys);
        }
    }
    return keys;
}

function humanizeFieldPath(path: string): string {
    const normalized = path.toLowerCase();
    if (normalized === "resource") return "what this action is for (email/calendar/task/etc.)";
    if (normalized === "ids") return "which specific item(s)";
    if (normalized === "filter.query") return "what to search for";
    if (normalized === "filter") return "search criteria";
    if (normalized === "changes") return "what to change";
    if (normalized === "data.to") return "recipient email address(es)";
    if (normalized === "data.subject") return "email subject";
    if (normalized === "data.body") return "email body";
    if (normalized === "data.title") return "title";
    if (normalized === "data.start") return "start time";
    if (normalized === "data.end") return "end time";
    if (normalized.startsWith("data.")) return normalized.replace("data.", "");
    return path;
}
