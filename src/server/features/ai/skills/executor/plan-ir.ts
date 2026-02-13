import type { CapabilityName } from "@/server/features/ai/skills/contracts/skill-contract";

export type PlanNodeType =
  | "capability_call"
  | "transform"
  | "conditional"
  | "policy_precheck"
  | "conditional_skip"
  | "postcondition_check";

export interface PlanNodeBase {
  id: string;
  type: PlanNodeType;
  description: string;
}

export interface CapabilityCallNode extends PlanNodeBase {
  type: "capability_call";
  capability: CapabilityName;
  requiredSlots: string[];
}

export interface PolicyPrecheckNode extends PlanNodeBase {
  type: "policy_precheck";
  capability: CapabilityName;
}

export interface ConditionalSkipNode extends PlanNodeBase {
  type: "conditional_skip";
  reason: string;
}

export interface TransformNode extends PlanNodeBase {
  type: "transform";
  transformKey: string;
}

export interface ConditionalNode extends PlanNodeBase {
  type: "conditional";
  conditionKey: string;
}

export interface PostconditionCheckNode extends PlanNodeBase {
  type: "postcondition_check";
  checkId: string;
}

export type PlanNode =
  | CapabilityCallNode
  | TransformNode
  | ConditionalNode
  | PolicyPrecheckNode
  | ConditionalSkipNode
  | PostconditionCheckNode;

export interface CompiledPlan {
  nodes: PlanNode[];
}
