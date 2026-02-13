import type { ToolPackManifest } from "@/server/features/ai/tools/packs/manifest-schema";
import { listInboxPackTools } from "@/server/features/ai/tools/packs/inbox/tools";

export function inboxToolPackManifest(): ToolPackManifest {
  const tools = listInboxPackTools();

  return {
    id: "inbox",
    name: "Inbox Pack",
    enabled: true,
    dependencies: [],
    requiredFlags: [],
    precedence: 10,
    groups: ["group:inbox"],
    tools,
  };
}
