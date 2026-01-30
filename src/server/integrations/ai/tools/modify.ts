
import { z } from "zod";
import { type ToolDefinition } from "./types";

export const modifyTool: ToolDefinition<any> = {
    name: "modify",
    description: `Modify existing items.
    
Email changes:
- archive: boolean (move to/from archive)
- trash: boolean (move to/from trash) -- prefer delete tool for trashing
- read: boolean (mark read/unread)
- labels: { add?: string[], remove?: string[] }

Calendar changes:
- Not yet implemented`,

    parameters: z.object({
        resource: z.enum([
            "email", "calendar", "automation", "preferences"
        ]),
        ids: z.array(z.string()).max(50).optional(),
        changes: z.record(z.string(), z.any()),
    }),

    execute: async ({ resource, ids, changes }, { providers }) => {
        switch (resource) {
            case "email":
                if (!ids || ids.length === 0) return { success: false, error: "No IDs provided" };
                return {
                    success: true,
                    data: await providers.email.modify(ids, changes),
                };

            case "calendar":
                return { success: false, error: "Calendar modify not implemented" };

            case "automation":
                return { success: false, error: "Automation modify not implemented" };

            default:
                return { success: false, error: `Resource ${resource} not supported` };
        }
    },

    securityLevel: "CAUTION",
};
