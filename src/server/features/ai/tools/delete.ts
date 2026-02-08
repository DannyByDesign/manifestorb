/**
 * AI Tool: delete
 *
 * Wraps server actions where applicable:
 * - automation: providers.automation.deleteRule
 * - knowledge: deleteKnowledgeAction (per id)
 * - email/calendar/drive/task: provider or prisma
 */

import { z } from "zod";
import { type ToolDefinition } from "./types";
import prisma from "@/server/db/client";

const deleteIdsSchema = z.array(z.string()).max(200);

const deleteParameters = z.discriminatedUnion("resource", [
    z.object({
        resource: z.literal("email"),
        ids: deleteIdsSchema,
    }).strict(),
    z.object({
        resource: z.literal("calendar"),
        ids: deleteIdsSchema,
        calendarId: z.string().optional(),
        mode: z.enum(["single", "series"]).optional(),
    }).strict(),
    z.object({
        resource: z.literal("automation"),
        ids: deleteIdsSchema,
    }).strict(),
    z.object({
        resource: z.literal("knowledge"),
        ids: deleteIdsSchema,
    }).strict(),
    z.object({
        resource: z.literal("draft"),
        ids: deleteIdsSchema,
    }).strict(),
    z.object({
        resource: z.literal("task"),
        ids: deleteIdsSchema,
    }).strict(),
    z.object({
        resource: z.literal("drive"),
        ids: deleteIdsSchema,
        driveItemType: z.enum(["file", "folder"]),
    }).strict(),
]);

export const deleteTool: ToolDefinition<typeof deleteParameters> = {
    name: "delete",
    description: `Delete items. Supports up to 200 IDs. For bulk email deletion, use the query tool with fetchAll: true first to retrieve all matching IDs.

When to use:
- Use delete for explicit remove/cancel intents.
- Use modify for non-destructive state changes (read/archive/update).
    
Email: Moves to trash (recoverable 30 days)
Calendar: Cancels event
Automation: Deletes rule
Drive: Deletes file or folder`,

    parameters: deleteParameters,

    execute: async ({ resource, ids, calendarId, mode, driveItemType }, { providers, userId, emailAccountId }) => {
        switch (resource) {
            case "email":
                return {
                    success: true,
                    data: await providers.email.trash(ids),
                };

            case "calendar":
                if (!providers.calendar) {
                    return { success: false, error: "Calendar provider not available" };
                }

                const deleteMode = mode ?? "single";
                await Promise.all(ids.map((id: string) =>
                    providers.calendar.deleteEvent({
                        calendarId,
                        eventId: id,
                        deleteOptions: { mode: deleteMode }
                    })
                ));
                return { success: true, data: { count: ids.length } };

            case "automation":
                // Delete Rules
                await Promise.all(ids.map((id: string) => providers.automation.deleteRule(id)));
                return { success: true, data: { count: ids.length } };

            case "knowledge": {
                if (!emailAccountId) {
                    return { success: false, error: "Email account ID is required for knowledge deletes" };
                }
                const { deleteKnowledgeAction } = await import("@/server/actions/knowledge");
                await Promise.all(
                    ids.map((id: string) =>
                        deleteKnowledgeAction(emailAccountId, { id })
                    )
                );
                return { success: true, data: { count: ids.length } };
            }

            case "draft":
                await Promise.all(ids.map((id: string) => providers.email.deleteDraft(id)));
                return { success: true, data: { count: ids.length } };

            case "task":
                const deleted = await prisma.task.deleteMany({
                    where: { id: { in: ids }, userId }
                });
                return { success: true, data: { count: deleted.count } };

            case "drive":
                if (!providers.drive) {
                    return { success: false, error: "Drive not connected" };
                }
                if (!driveItemType) {
                    return { success: false, error: "driveItemType is required for drive deletes" };
                }
                if (driveItemType === "file") {
                    await Promise.all(ids.map((id) => providers.drive!.deleteFile(id)));
                } else {
                    await Promise.all(ids.map((id) => providers.drive!.deleteFolder(id)));
                }
                return { success: true, data: { count: ids.length } };

            default:
                return { success: false, error: `Resource ${resource} not supported` };
        }
    },

    securityLevel: "CAUTION",
};
