import { type ToolContext } from "./types";

interface AuditLogEntry {
    timestamp: Date;
    userId: string;
    emailAccountId: string;
    tool: string;
    params: any;
    success: boolean;
    error?: string;
    durationMs: number;
}

// In a real app, this would write to a database table (e.g., specific Prisma model)
// For now, we'll just log to the console/logger provided in context

export async function auditLog(entry: AuditLogEntry, context: ToolContext): Promise<void> {
    const { logger } = context;

    const logData = {
        ...entry,
        params: sanitizeForLog(entry.params),
    };

    if (entry.success) {
        logger.info("Tool Execution Success", logData);
    } else {
        logger.error("Tool Execution Failed", logData);
    }

    // existing codebase likely has a persistent logger or we should add a DB call here
    // typically: await prisma.auditLog.create({ data: ... })
}

function sanitizeForLog(params: any): any {
    if (!params) return params;

    const sanitized = { ...params };

    // Redact potentially sensitive fields if they appear in params
    if (sanitized.data) {
        if (sanitized.data.body) sanitized.data.body = "[REDACTED]";
        // Add other redactions as necessary
    }

    return sanitized;
}
