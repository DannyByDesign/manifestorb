
import { z } from "zod";
import { type ToolDefinition } from "./types";
import prisma from "@/server/db/client";

export const deleteTool: ToolDefinition<any> = {
    name: "delete",
    description: `Delete items.
    
Email: Moves to trash (recoverable for 30 days)
Calendar: Cancels event
Automation: Deletes rule
Drive: Deletes file or folder`,

    parameters: z.object({
        resource: z.enum(["email", "calendar", "automation", "knowledge", "task", "drive"]),
        ids: z.array(z.string()).max(50),
        calendarId: z.string().optional(),
        mode: z.enum(["single", "series"]).optional(),
        driveItemType: z.enum(["file", "folder"]).optional(),
    }),

    execute: async ({ resource, ids, calendarId, mode, driveItemType }, { providers }) => {
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

                await Promise.all(ids.map((id: string) =>
                    providers.calendar.deleteEvent({
                        calendarId,
                        eventId: id,
                        deleteOptions: { mode }
                    })
                ));
                return { success: true, data: { count: ids.length } };

            case "automation":
                // Delete Rules
                await Promise.all(ids.map((id: string) => providers.automation.deleteRule(id)));
                return { success: true, data: { count: ids.length } };

            case "knowledge":
                // Delete Knowledge
                await Promise.all(ids.map((id: string) => providers.automation.deleteKnowledge(id)));
                return { success: true, data: { count: ids.length } };

            case "task":
                await prisma.task.deleteMany({ where: { id: { in: ids } } });
                return { success: true, data: { count: ids.length } };

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
