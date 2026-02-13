import type { CapabilityName } from "@/server/features/ai/skills/contracts/skill-contract";
import type { SkillId } from "@/server/features/ai/skills/baseline/skill-ids";

export type SkillTelemetryEvent =
  | {
      name: "skill.route.completed";
      requestId: string;
      provider: string;
      skillId: SkillId | null;
      confidence: number;
      reason: string;
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
      toolChain: CapabilityName[];
      stepDurationsMs: Record<string, number>;
      postconditionsPassed: boolean;
      failureReason?: string;
    };
