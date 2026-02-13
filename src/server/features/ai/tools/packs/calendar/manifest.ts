import type { ToolPackManifest } from "@/server/features/ai/tools/packs/manifest-schema";
import { listCalendarPackTools } from "@/server/features/ai/tools/packs/calendar/tools";

export function calendarToolPackManifest(): ToolPackManifest {
  const tools = listCalendarPackTools();

  return {
    id: "calendar",
    name: "Calendar Pack",
    enabled: true,
    dependencies: [],
    requiredFlags: [],
    precedence: 10,
    groups: ["group:calendar"],
    tools,
  };
}
