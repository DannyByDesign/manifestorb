
import { z } from "zod";
import { type ToolDefinition } from "./types";
import prisma from "@/server/db/client";
import { getDraftById } from "@/features/drafts/operations";

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

export const getTool: ToolDefinition<typeof getParameters> = {
    name: "get",
    description: `Get full details of specific item(s) by ID.

When to use:
- Use get after query returns IDs and you need complete records.
- Do not use get for broad search; use query first.
- For derived insights (summaries/conflicts), use analyze after get/query.`,

    parameters: getParameters,

    execute: async (params, { providers, userId }) => {
        const { resource, ids } = params;
        const calendarId = "calendarId" in params ? params.calendarId : undefined;
        const includeReason =
            "includeReason" in params ? params.includeReason : undefined;
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
                    ids.map(async (id: string) => getDraftById(providers.email, id))
                );
                return {
                    success: true,
                    data: drafts.filter(Boolean),
                };

            case "automation":
                if (!providers.automation) {
                    return { success: false, error: "Automation provider not available" };
                }

                const [rules, knowledge] = await Promise.all([
                    providers.automation.listRules(),
                    providers.automation.listKnowledge(),
                ]);
                const byId = new Map<string, unknown>();
                for (const rule of rules) byId.set(rule.id, { type: "rule", ...rule });
                for (const item of knowledge) byId.set(item.id, { type: "knowledge", ...item });

                const found = ids
                    .map((id: string) => byId.get(id))
                    .filter((item): item is Record<string, unknown> => Boolean(item));
                const missingIds = ids.filter((id: string) => !byId.has(id));

                return {
                    success: missingIds.length === 0,
                    data: found,
                    ...(missingIds.length > 0
                        ? { error: `Automation items not found: ${missingIds.join(", ")}` }
                        : {}),
                };

            case "approval":
                const approvals = await prisma.approvalRequest.findMany({
                    where: { id: { in: ids }, userId },
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
