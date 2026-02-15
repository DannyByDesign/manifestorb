import { listToolDefinitions } from "@/server/features/ai/tools/runtime/capabilities/registry";

export function listCalendarPackTools(): string[] {
  const tools = listToolDefinitions()
    .map((definition) => definition.id)
    .filter(
      (name) => name.startsWith("calendar.") || name === "task.reschedule",
    );
  return tools;
}
