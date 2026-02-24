
import { type z } from "zod";
import { type EmailProvider } from "./providers/email";
import { type CalendarProvider } from "./providers/calendar";
import { type Logger } from "@/server/lib/logger";

export type Resource = "email" | "calendar" | "contacts" | "automation" | "knowledge" | "preferences" | "patterns" | "report" | "notification" | "approval" | "summary" | "task";

export interface Filter {
    query?: string;
    dateRange?: {
        after?: string;
        before?: string;
    };
    limit?: number;
}

export interface Changes {
    [key: string]: unknown;
}

export interface ToolContext {
    userId: string;
    emailAccountId: string;
    /** Optional: link created tasks to the source email (cross-feature FK) */
    emailMessageId?: string;
    /** Optional: source email thread context for pronoun attendee resolution. */
    emailThreadId?: string;
    /** Optional: link created tasks to the conversation (cross-feature FK) */
    conversationId?: string;
    /** Optional: raw user message for intent-sensitive tool behavior. */
    currentMessage?: string;
    logger: Logger;
    providers: {
        email: EmailProvider;
        calendar: CalendarProvider;
        // Add others as needed
    };
}

export interface InteractiveAction {
    label: string;
    style: "primary" | "danger";
    value: string;
    url?: string;
}

export interface DraftPreview {
    to: string[];
    cc?: string[];
    bcc?: string[];
    subject: string;
    body: string;
}

export interface ActionRequestContext {
    resource: "calendar" | "task";
    action: "create" | "modify" | "delete" | "reschedule";
    title?: string;
    timeRange?: string;
}

export interface InteractivePayload {
    type: "approval_request" | "draft_created" | "action_request" | "ambiguous_time";
    approvalId?: string;
    draftId?: string;
    emailAccountId?: string;
    userId?: string;
    ambiguousRequestId?: string;
    summary: string;
    actions: InteractiveAction[];
    preview?: DraftPreview;
    context?: ActionRequestContext;
}

export interface AmbiguousTimePayload {
    originalTool: "create" | "modify";
    originalArgs: Record<string, unknown>;
    options: {
        earlier: { start: string; end?: string };
        later: { start: string; end?: string };
        timeZone: string;
    };
    message: string;
}

export interface ToolEvidenceMetadata {
    domain?: "email" | "calendar" | "task" | "planner" | "policy" | "memory" | "web";
    observedAt?: string;
    scope?: string;
    coverage?: "complete" | "partial";
    reusableForFollowUp?: boolean;
    staleAfterSec?: number;
}

export interface ToolResult {
    success: boolean;
    data?: unknown;
    error?: string;
    message?: string;
    clarification?: {
        kind:
            | "resource"
            | "missing_fields"
            | "invalid_fields"
            | "permissions"
            | "rate_limit"
            | "concept_definition_required"
            | "other";
        prompt: string;
        missingFields?: string[];
    };
    truncated?: boolean;
    paging?: Record<string, unknown>;
    evidence?: ToolEvidenceMetadata;
    meta?: {
        resource?: string;
        requestedIds?: string[];
        itemCount?: number;
        durationMs?: number;
    };
    interactive?: InteractivePayload;
}

export interface ToolDefinition<T extends z.ZodType> {
    name: string;
    description: string;
    parameters: T;
    execute: (params: z.infer<T>, context: ToolContext) => Promise<ToolResult>;
    securityLevel: "SAFE" | "CAUTION" | "DANGEROUS";
}
