import type { CapabilityName } from "@/server/features/ai/skills/contracts/skill-contract";
import type { SkillId } from "@/server/features/ai/skills/baseline/skill-ids";

export type SkillTelemetryEvent =
  | {
      name: "skill.route.completed";
      requestId: string;
      provider: string;
      routeType?: "skill" | "planner" | "clarify";
      skillId: SkillId | null;
      confidence: number;
      reason: string;
      semanticParseConfidence: number;
      routedFamilies: string[];
      unresolvedEntities: string[];
      finalOutcome?: string;
    }
  | {
      name: "planner.route.selected";
      requestId: string;
      provider: string;
      userId: string;
      routeType: "planner";
      candidateCount: number;
      semanticParseConfidence: number;
      routedFamilies: string[];
      reason: string;
    }
  | {
      name: "planner.execution.completed";
      requestId: string;
      provider: string;
      userId: string;
      routeType: "planner";
      finalOutcome: "success" | "partial" | "blocked" | "failed";
      diagnosticsCode?: string;
      diagnosticsCategory?: string;
      stepCount: number;
      approvalCount: number;
      reason?: string;
    }
  | {
      name: "planner.validation.failed";
      requestId: string;
      provider: string;
      userId: string;
      routeType: "planner";
      reason: string;
      issues: string[];
    }
  | {
      name: "skill.slot_resolution.completed";
      requestId: string;
      provider: string;
      skillId: SkillId;
      missingRequired: number;
      ambiguous: number;
      missingRequiredSlots: string[];
      ambiguousSlots: string[];
      clarificationPrompt?: string;
    }
  | {
      name: "skill.execution.completed";
      requestId: string;
      provider: string;
      skillId: SkillId;
      status: "success" | "partial" | "blocked" | "failed";
      stepsExecuted: number;
      stepGraphSize: number;
      toolChain: CapabilityName[];
      capabilityChain: CapabilityName[];
      stepDurationsMs: Record<string, number>;
      postconditionsPassed: boolean;
      postconditionPassRate: number;
      policyBlockCount: number;
      repairAttemptCount: number;
      finalOutcome: "success" | "partial" | "blocked" | "failed";
      diagnosticsCode?: string;
      diagnosticsCategory?: string;
      failureReason?: string;
    }
  | {
      name: "skill.action.completed";
      requestId: string;
      provider: string;
      userId: string;
      skillId: SkillId;
      capability: CapabilityName;
      stepId: string;
      success: boolean;
      policyDecision: "allowed" | "blocked" | "not_applicable";
      itemCount: number;
      errorCode?: string;
    };
