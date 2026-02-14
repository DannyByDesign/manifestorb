import type { ZodTypeAny } from "zod";
import type { ToolResult } from "@/server/features/ai/tools/types";
import type { CapabilityDefinition } from "@/server/features/ai/tools/runtime/capabilities/registry";
import type { SkillCapabilities } from "@/server/features/ai/tools/runtime/capabilities";
import type { RuntimeToolExecutor } from "@/server/features/ai/tools/runtime/capabilities/executors/types";
import type { PolicyApprovalRecord, PolicyExecutionContext } from "@/server/features/ai/policy/enforcement";

export interface RuntimeToolDefinition {
  toolName: string;
  description: string;
  parameters: ZodTypeAny;
  metadata: CapabilityDefinition;
  execute: RuntimeToolExecutor;
}

export interface ToolAssemblyContext {
  policy: PolicyExecutionContext;
  capabilities: SkillCapabilities;
}

export interface ToolExecutionArtifacts {
  approvals: PolicyApprovalRecord[];
  interactivePayloads: unknown[];
}

export interface ToolExecutionSummary {
  toolName: string;
  outcome: "success" | "partial" | "blocked" | "failed";
  durationMs: number;
  result: ToolResult;
}
