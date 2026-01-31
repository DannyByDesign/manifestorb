
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
                const emails = await providers.email.search(filter?.query || "", limit);
                // Map to DomainObjectRef (Summary)
                return {
                    success: true,
                    data: emails.map((e: any) => ({
                        id: e.id,
                        title: e.subject || "(No Subject)",
                        snippet: e.snippet || e.body?.substring(0, 150) || "",
                        date: e.date,
                        source: "email",
                        from: e.from
                    })),
                };

            case "calendar":
                const events = await providers.calendar.searchEvents(filter?.query || "", {
                    start: filter?.dateRange?.after ? new Date(filter.dateRange.after) : new Date(),
                    end: filter?.dateRange?.before ? new Date(filter.dateRange.before) : new Date(Date.now() + 86400000)
                });
                return {
                    success: true,
                    data: events.map((e: any) => ({
                        id: e.id,
                        title: e.title || "(No Title)",
                        snippet: `Time: ${e.start} - ${e.end}. Attendees: ${e.attendees?.join(", ")}`,
                        date: e.start,
                        source: "calendar"
                    }))
                };

            case "automation":
                const rules = await providers.automation.listRules();
                return {
                    success: true,
                    data: rules.map((r: any) => ({
                        id: r.id, // Ensure Rule has ID or use name
                        title: r.name,
                        snippet: `Enabled: ${r.enabled}. Actions: ${r.actions?.map((a: any) => a.type).join(", ")}`,
                        source: "automation"
                    }))
                };

            default:
                return { success: false, error: `Resource ${resource} not supported yet` };
        }
    },

    securityLevel: "SAFE",
};
