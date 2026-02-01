
import { z } from "zod";
import { type ToolDefinition } from "./types";
import prisma from "@/server/db/client";

export const getTool: ToolDefinition<any> = {
    name: "get",
    description: `Get full details of specific item(s) by ID.`,

    parameters: z.object({
        resource: z.enum([
            "email", "calendar", "automation", "approval"
        ]),
        ids: z.array(z.string()).max(20), // Max 20 objects per step as per Hardening Budget
    }),

    execute: async ({ resource, ids }, { providers }) => {
        switch (resource) {
            case "email":
                return {
                    success: true,
                    data: await providers.email.get(ids),
                };

            case "calendar":
                // Stub - assume getEvents exists or similar
                return {
                    success: true,
                    data: [],
                    error: "Calendar get not implemented yet"
                };

            case "automation":
                // Stub
                return {
                    success: true,
                    data: [],
                    error: "Automation get not implemented yet"
                };

            case "approval":
                const approvals = await prisma.approvalRequest.findMany({
                    where: { id: { in: ids } },
                    include: { decisions: true }
                });
                return {
                    success: true,
                    data: approvals
                };

            default:
                return { success: false, error: `Resource ${resource} not supported yet` };
        }
    },

    securityLevel: "SAFE",
};
