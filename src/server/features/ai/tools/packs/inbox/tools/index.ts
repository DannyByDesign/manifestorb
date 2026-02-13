import { listToolDefinitions } from "@/server/features/ai/tools/runtime/legacy/registry";

export function listInboxPackTools(): string[] {
  return listToolDefinitions()
    .map((definition) => definition.id)
    .filter((name) => name.startsWith("email."));
}
