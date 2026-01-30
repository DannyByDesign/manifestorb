
import { z } from "zod";
import { type ToolDefinition } from "./types";

export const queryTool: ToolDefinition<any> = {
    name: "query",
    description: `Search and retrieve items from any resource.
    
Resources:
- email: Search emails (supports Gmail/Outlook query syntax)
- calendar: Search events by date range, attendees, title
- automation: List rules and their configurations`,

    parameters: z.object({
        resource: z.enum([
            "email", "calendar", "automation"
        ]),
        filter: z.object({
            query: z.string().optional(),      // Search query
            dateRange: z.object({
                after: z.string().optional(),    // ISO date
                before: z.string().optional(),
            }).optional(),
            limit: z.number().max(50).default(20),
        }).optional(),
    }),

    execute: async ({ resource, filter }, { providers }) => {
        const limit = filter?.limit || 20;

        switch (resource) {
            case "email":
                // For email, we pass the query string directly
                // Date range should ideally be appended to the query if not already present,
                // but for now we rely on the query string.
                return {
                    success: true,
                    data: await providers.email.search(filter?.query || "", limit),
                };

            case "calendar":
                // Stub
                return {
                    success: true,
                    data: await providers.calendar.searchEvents(filter?.query || "", {
                        start: filter?.dateRange?.after ? new Date(filter.dateRange.after) : new Date(),
                        end: filter?.dateRange?.before ? new Date(filter.dateRange.before) : new Date(Date.now() + 86400000)
                    }),
                };

            case "automation":
                return {
                    success: true,
                    data: await providers.automation.listRules()
                };

            default:
                return { success: false, error: `Resource ${resource} not supported yet` };
        }
    },

    securityLevel: "SAFE",
};
