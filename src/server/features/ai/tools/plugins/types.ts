import type { RuntimeToolDefinition } from "@/server/features/ai/tools/fabric/types";

export interface ToolPlugin {
  id: string;
  name: string;
  precedence: number;
  groups: string[];
  tools: RuntimeToolDefinition[];
}

export interface ToolPluginConflict {
  toolName: string;
  winnerPluginId: string;
  loserPluginId: string;
}
