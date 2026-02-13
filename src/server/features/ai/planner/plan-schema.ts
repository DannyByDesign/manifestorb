import { z } from "zod";
import {
  capabilityNameSchema,
} from "@/server/features/ai/skills/contracts/skill-contract";
import type { PlannerPlan } from "@/server/features/ai/planner/types";

export const plannerRiskSchema = z.enum(["safe", "caution", "dangerous"]);

export const plannerStepSchema = z
  .object({
    id: z.string().min(1),
    capability: capabilityNameSchema,
    args: z.record(z.string(), z.unknown()),
    dependsOn: z.array(z.string().min(1)).optional(),
    postcondition: z.string().min(1).optional(),
    risk: plannerRiskSchema.optional(),
  })
  .strict();

export const plannerPlanSchema = z
  .object({
    goal: z.string().min(1),
    steps: z.array(plannerStepSchema).min(1).max(12),
  })
  .strict();

export function parsePlannerPlan(input: unknown): PlannerPlan {
  return plannerPlanSchema.parse(input);
}
