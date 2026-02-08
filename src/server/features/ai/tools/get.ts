
import { z } from "zod";
import { type ToolDefinition } from "./types";
import prisma from "@/server/db/client";

const idsSchema = z.array(z.string()).max(20);

const getParameters = z.discriminatedUnion("resource", [
    z.object({
        resource: z.literal("email"),
        ids: idsSchema,
    }).strict(),
    z.object({
        resource: z.literal("calendar"),
        ids: idsSchema,
        calendarId: z.string().optional(),
    }).strict(),
    z.object({
        resource: z.literal("automation"),
        ids: idsSchema,
    }).strict(),
    z.object({
        resource: z.literal("draft"),
        ids: idsSchema,
    }).strict(),
    z.object({
        resource: z.literal("approval"),
        ids: idsSchema,
    }).strict(),
    z.object({
        resource: z.literal("task"),
        ids: idsSchema,
        includeReason: z.boolean().optional(),
    }).strict(),
]);

export const getTool: ToolDefinition<any> = {
    name: "get",
    description: `Get full details of specific item(s) by ID.

When to use:
- Use get after query returns IDs and you need complete records.
- Do not use get for broad search; use query first.
- For derived insights (summaries/conflicts), use analyze after get/query.`,

    parameters: getParameters,

    execute: async ({ resource, ids, calendarId, includeReason }, { providers, userId }) => {
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

            case "draft":
                const drafts = await Promise.all(
                    ids.map(async (id: string) => providers.email.getDraft(id))
                );
                return {
                    success: true,
                    data: drafts.filter(Boolean),
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
                    where: { id: { in: ids }, userId }
                });
                if (!includeReason) {
                    return { success: true, data: tasks };
                }

                const reasons = await prisma.taskSchedulingReason.findMany({
                    where: {
                        taskId: { in: ids },
                        expiresAt: { gt: new Date() },
                        task: { userId },
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
