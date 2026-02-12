import type { ToolResult } from "@/server/features/ai/tools/types";

export interface PlannerCapabilities {
  composeDayPlan(input: {
    topEmailItems: unknown[];
    calendarItems: unknown[];
    focusSuggestions?: string[];
  }): Promise<ToolResult>;
}

export function createPlannerCapabilities(): PlannerCapabilities {
  return {
    async composeDayPlan(input) {
      const emailCount = Array.isArray(input.topEmailItems) ? input.topEmailItems.length : 0;
      const calendarCount = Array.isArray(input.calendarItems) ? input.calendarItems.length : 0;
      return {
        success: true,
        data: {
          summary: `Daily plan built from ${emailCount} email priorities and ${calendarCount} calendar items.`,
          topEmailItems: input.topEmailItems,
          calendarItems: input.calendarItems,
          focusSuggestions: input.focusSuggestions ?? [],
        },
      };
    },
  };
}
