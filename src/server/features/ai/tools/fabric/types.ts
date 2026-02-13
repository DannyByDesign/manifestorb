import type { ZodTypeAny } from "zod";
import type { ToolResult } from "@/server/features/ai/tools/types";
import type { CapabilityName } from "@/server/features/ai/skills/contracts/skill-contract";
import type { CapabilityDefinition } from "@/server/features/ai/capabilities/registry";
import type { SkillCapabilities } from "@/server/features/ai/capabilities";
import type { PolicyApprovalRecord, PolicyExecutionContext } from "@/server/features/ai/policy/enforcement";

export interface RuntimeToolDefinition {
  toolName: string;
  capabilityId: CapabilityName;
  description: string;
  parameters: ZodTypeAny;
  metadata: CapabilityDefinition;
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
  capabilityId: CapabilityName;
  outcome: "success" | "partial" | "blocked" | "failed";
  durationMs: number;
  result: ToolResult;
}
