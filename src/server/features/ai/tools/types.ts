
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

export interface ToolResult {
    success: boolean;
    data?: any;
    error?: string;
    meta?: {
        itemCount?: number;
        durationMs?: number;
    };
}

export interface ToolDefinition<T extends z.ZodType> {
    name: string;
    description: string;
    parameters: T;
    execute: (params: z.infer<T>, context: ToolContext) => Promise<ToolResult>;
    securityLevel: "SAFE" | "CAUTION" | "DANGEROUS";
}
