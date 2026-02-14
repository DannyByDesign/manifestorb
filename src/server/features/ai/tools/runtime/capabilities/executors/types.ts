import type { SkillCapabilities } from "@/server/features/ai/tools/runtime/capabilities";
import type { ToolName } from "@/server/features/ai/tools/runtime/capabilities/registry";
import type { ToolResult } from "@/server/features/ai/tools/types";

export interface RuntimeToolExecutorParams {
  args: Record<string, unknown>;
  capabilities: SkillCapabilities;
}

export type RuntimeToolExecutor = (
  params: RuntimeToolExecutorParams,
) => Promise<ToolResult>;

export type RuntimeToolExecutorMap = Partial<Record<ToolName, RuntimeToolExecutor>>;
