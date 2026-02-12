import type { CapabilityName } from "@/server/features/ai/skills/contracts/skill-contract";
import type { SkillId } from "@/server/features/ai/skills/baseline/skill-ids";

export type SkillsMode = "off" | "shadow" | "on";

export type SkillTelemetryEvent =
  | {
      name: "skill.route.completed";
      skillsMode: SkillsMode;
      requestId: string;
      provider: string;
      skillId: SkillId | null;
      confidence: number;
      reason: string;
    }
  | {
      name: "skill.slot_resolution.completed";
      skillsMode: SkillsMode;
      requestId: string;
      provider: string;
      skillId: SkillId;
      missingRequired: number;
      ambiguous: number;
    }
  | {
      name: "skill.execution.completed";
      skillsMode: SkillsMode;
      requestId: string;
      provider: string;
      skillId: SkillId;
      status: "success" | "partial" | "blocked" | "failed";
      stepsExecuted: number;
      toolChain: CapabilityName[];
      postconditionsPassed: boolean;
      failureReason?: string;
    };
