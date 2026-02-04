
import { z } from "zod";
import { type ToolDefinition } from "./types";
import prisma from "@/server/db/client";

export const getTool: ToolDefinition<any> = {
    name: "get",
    description: `Get full details of specific item(s) by ID.`,

    parameters: z.object({
        resource: z.enum([
            "email", "calendar", "automation", "approval", "task"
        ]),
        ids: z.array(z.string()).max(20), // Max 20 objects per step as per Hardening Budget
        calendarId: z.string().optional(),
        includeReason: z.boolean().optional(),
    }),

    execute: async ({ resource, ids, calendarId, includeReason }, { providers }) => {
        switch (resource) {
            case "email":
                return {
                    success: true,
                    data: await providers.email.get(ids),
                };

            case "calendar":
                if (!providers.calendar) {
                    return { success: false, error: "Calendar provider not available" };
                }

                const events = await Promise.all(ids.map((id: string) =>
                    providers.calendar.getEvent({ eventId: id, calendarId })
                ));

                return {
                    success: true,
                    data: events.filter(Boolean)
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

            case "task":
                const tasks = await prisma.task.findMany({
                    where: { id: { in: ids } }
                });
                if (!includeReason) {
                    return { success: true, data: tasks };
                }

                const reasons = await prisma.taskSchedulingReason.findMany({
                    where: {
                        taskId: { in: ids },
                        expiresAt: { gt: new Date() }
                    },
                    select: {
                        taskId: true,
                        reason: true,
                        expiresAt: true,
                        updatedAt: true
                    }
                });

                const reasonByTaskId = new Map(reasons.map((r) => [r.taskId, r]));
                const tasksWithReason = tasks.map((task) => ({
                    ...task,
                    schedulingReason: reasonByTaskId.get(task.id) ?? null
                }));

                return { success: true, data: tasksWithReason };

            default:
                return { success: false, error: `Resource ${resource} not supported yet` };
        }
    },

    securityLevel: "SAFE",
};
