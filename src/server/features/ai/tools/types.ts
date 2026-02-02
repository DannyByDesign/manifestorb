
import { type z } from "zod";
import { type EmailProvider } from "./providers/email";
import { type CalendarProvider } from "./providers/calendar";
import { type AutomationProvider } from "./providers/automation";
import { type DriveProvider } from "./providers/drive";

export type Resource = "email" | "calendar" | "drive" | "contacts" | "automation" | "knowledge" | "preferences" | "patterns" | "report" | "notification" | "approval" | "summary";

export interface Filter {
    query?: string;
    dateRange?: {
        after?: string;
        before?: string;
    };
    limit?: number;
}

export interface Changes {
    [key: string]: any;
}

export interface ToolContext {
    userId: string;
    emailAccountId: string;
    logger: any;
    providers: {
        email: EmailProvider;
        calendar: CalendarProvider;
        automation: AutomationProvider;
        drive?: DriveProvider;
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

export interface InteractivePayload {
    type: "approval_request" | "draft_created";
    approvalId?: string;
    draftId?: string;
    emailAccountId?: string;
    userId?: string;
    summary: string;
    actions: InteractiveAction[];
    preview?: DraftPreview;
}

export interface ToolResult {
    success: boolean;
    data?: any;
    error?: string;
    meta?: {
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
