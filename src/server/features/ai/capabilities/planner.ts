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
      const emailLines =
        Array.isArray(input.topEmailItems) && input.topEmailItems.length
          ? input.topEmailItems.slice(0, 10).map((it, idx) => {
              const obj = it && typeof it === "object" ? (it as Record<string, unknown>) : {};
              const title = typeof obj.title === "string" ? obj.title : "(No subject)";
              const snippet = typeof obj.snippet === "string" ? obj.snippet : "";
              return `${idx + 1}. ${title}${snippet ? `\n   - ${snippet}` : ""}`;
            })
          : [];

      const calendarLines =
        Array.isArray(input.calendarItems) && input.calendarItems.length
          ? input.calendarItems.slice(0, 10).map((it, idx) => {
              const obj = it && typeof it === "object" ? (it as Record<string, unknown>) : {};
              const title = typeof obj.title === "string" ? obj.title : "(No title)";
              const snippet = typeof obj.snippet === "string" ? obj.snippet : "";
              return `${idx + 1}. ${title}${snippet ? `\n   - ${snippet}` : ""}`;
            })
          : [];

      const messageParts: string[] = [];
      if (emailLines.length) {
        messageParts.push("Top email actions:");
        messageParts.push(...emailLines);
      }
      if (calendarLines.length) {
        if (messageParts.length) messageParts.push("");
        messageParts.push("Upcoming calendar items:");
        messageParts.push(...calendarLines);
      }

      return {
        success: true,
        data: {
          summary: `Daily plan built from ${emailCount} email priorities and ${calendarCount} calendar items.`,
          topEmailItems: input.topEmailItems,
          calendarItems: input.calendarItems,
          focusSuggestions: input.focusSuggestions ?? [],
        },
        message:
          messageParts.length > 0
            ? messageParts.join("\n")
            : `No items found to plan from (${emailCount} email priorities, ${calendarCount} calendar items).`,
      };
    },
  };
}
