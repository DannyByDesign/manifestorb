
import { z } from "zod";
import { type ToolDefinition } from "./types";

export const createTool: ToolDefinition<any> = {
    name: "create",
    description: `Create new items.
    
Email: Creates a DRAFT only. User must manually send from UI.
- type: "new" | "reply" | "forward"
- For reply/forward: provide parentId (thread ID / message ID)
- Returns: { draftId, previewUrl } for user to review and send

Calendar: Not implemented.

Automation: Not implemented.`,

    parameters: z.object({
        resource: z.enum(["email", "calendar", "automation", "knowledge"]),
        type: z.enum(["new", "reply", "forward"]).optional(),
        parentId: z.string().optional(),
        data: z.object({
            // Email
            to: z.array(z.string()).optional(),
            cc: z.array(z.string()).optional(),
            bcc: z.array(z.string()).optional(),
            subject: z.string().optional(),
            body: z.string().optional(),

            // Calendar
            title: z.string().optional(),
            start: z.string().optional(),
            end: z.string().optional(),
            attendees: z.array(z.string()).optional(),
            location: z.string().optional(),

            // Automation
            name: z.string().optional(),
            conditions: z.any().optional(),
            actions: z.array(z.any()).optional(),
        }),
    }),

    execute: async ({ resource, type, parentId, data }, { providers }) => {
        switch (resource) {
            case "email":
                // Map params to DraftParams
                return {
                    success: true,
                    data: await providers.email.createDraft({
                        type: (type as "new" | "reply" | "forward") || "new",
                        parentId,
                        to: data.to,
                        cc: data.cc,
                        bcc: data.bcc,
                        subject: data.subject,
                        body: data.body
                    }),
                };

            case "calendar":
                return { success: false, error: "Calendar create not implemented" };

            default:
                return { success: false, error: `Resource ${resource} not supported` };
        }
    },

    securityLevel: "CAUTION",
};
