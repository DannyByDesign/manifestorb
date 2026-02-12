import { executeTool } from "@/server/features/ai/tools/executor";
import { createTool } from "@/server/features/ai/tools/create";
import { modifyTool } from "@/server/features/ai/tools/modify";
import type { ToolResult } from "@/server/features/ai/tools/types";
import type { CapabilityEnvironment } from "@/server/features/ai/capabilities/types";

export interface CalendarCapabilities {
  findAvailability(filter: Record<string, unknown>): Promise<ToolResult>;
  createEvent(data: Record<string, unknown>): Promise<ToolResult>;
  rescheduleEvent(eventIds: string[], changes: Record<string, unknown>): Promise<ToolResult>;
  setWorkingHours(changes: Record<string, unknown>): Promise<ToolResult>;
  setOutOfOffice(data: Record<string, unknown>): Promise<ToolResult>;
  createFocusBlock(data: Record<string, unknown>): Promise<ToolResult>;
  createBookingSchedule(data: Record<string, unknown>): Promise<ToolResult>;
}

export function createCalendarCapabilities(env: CapabilityEnvironment): CalendarCapabilities {
  return {
    async findAvailability(filter) {
      // NOTE: This is intentionally NOT "query calendar events".
      // It computes free slots using the calendar provider's scheduling primitives.
      try {
        const durationMinutesRaw = (filter as Record<string, unknown>).durationMinutes ?? (filter as Record<string, unknown>).duration;
        const durationMinutes = Math.max(
          5,
          Number.isFinite(Number(durationMinutesRaw)) ? Number(durationMinutesRaw) : 30,
        );
        const startRaw = (filter as Record<string, unknown>).start;
        const endRaw = (filter as Record<string, unknown>).end;
        const start = typeof startRaw === "string" ? new Date(startRaw) : undefined;
        const end = typeof endRaw === "string" ? new Date(endRaw) : undefined;

        const slots = await env.toolContext.providers.calendar.findAvailableSlots({
          durationMinutes,
          ...(start && !Number.isNaN(start.getTime()) ? { start } : {}),
          ...(end && !Number.isNaN(end.getTime()) ? { end } : {}),
        });

        return {
          success: true,
          data: { slots },
          meta: { resource: "calendar", itemCount: slots.length },
          message:
            slots.length === 0
              ? "No available slots found in that window."
              : `Found ${slots.length} available slots.`,
        };
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        return {
          success: false,
          error: message,
          message: "I couldn't compute availability right now.",
        };
      }
    },

    async createEvent(data) {
      return executeTool(createTool, { resource: "calendar", data }, env.toolContext);
    },

    async rescheduleEvent(eventIds, changes) {
      return executeTool(
        modifyTool,
        {
          resource: "calendar",
          ids: eventIds,
          changes,
        },
        env.toolContext,
      );
    },

    async setWorkingHours(changes) {
      return executeTool(
        modifyTool,
        {
          resource: "preferences",
          changes,
        },
        env.toolContext,
      );
    },

    async setOutOfOffice(data) {
      return executeTool(createTool, { resource: "calendar", data }, env.toolContext);
    },

    async createFocusBlock(data) {
      return executeTool(createTool, { resource: "calendar", data }, env.toolContext);
    },

    async createBookingSchedule(data) {
      void data;
      return {
        success: false,
        error: "Booking schedule capability is not implemented yet.",
        message: "Booking page setup is not yet supported in this skill path.",
      };
    },
  };
}
