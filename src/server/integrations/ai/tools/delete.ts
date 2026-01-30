
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
                return { success: false, error: "Automation delete not implemented" };

            default:
                return { success: false, error: `Resource ${resource} not supported` };
        }
    },

    securityLevel: "CAUTION",
};
