
import { z } from "zod";
import { type ToolDefinition } from "./types";

export const deleteTool: ToolDefinition<any> = {
    name: "delete",
    description: `Delete items.
    
Email: Moves to trash (recoverable for 30 days)
Calendar: Cancels event
Automation: Deletes rule`,

    parameters: z.object({
        resource: z.enum(["email", "calendar", "automation", "knowledge"]),
        ids: z.array(z.string()).max(50),
    }),

    execute: async ({ resource, ids }, { providers }) => {
        switch (resource) {
            case "email":
                return {
                    success: true,
                    data: await providers.email.trash(ids),
                };

            case "calendar":
                return { success: false, error: "Calendar delete not implemented" };

            case "automation":
                // Delete Rules
                await Promise.all(ids.map((id: string) => providers.automation.deleteRule(id)));
                return { success: true, data: { count: ids.length } };

            case "knowledge":
                // Delete Knowledge
                await Promise.all(ids.map((id: string) => providers.automation.deleteKnowledge(id)));
                return { success: true, data: { count: ids.length } };

            default:
                return { success: false, error: `Resource ${resource} not supported` };
        }
    },

    securityLevel: "CAUTION",
};
