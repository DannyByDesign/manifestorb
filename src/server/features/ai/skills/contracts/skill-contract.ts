import { z } from "zod";
import { BASELINE_SKILL_IDS, type SkillId } from "@/server/features/ai/skills/baseline/skill-ids";

export const capabilityNameSchema = z.enum([
  "email.searchThreads",
  "email.getThreadMessages",
  "email.batchArchive",
  "email.unsubscribeSender",
  "email.snoozeThread",
  "email.createDraft",
  "email.scheduleSend",
  "calendar.findAvailability",
  "calendar.listEvents",
  "calendar.createEvent",
  "calendar.rescheduleEvent",
  "calendar.setWorkingHours",
  "calendar.setOutOfOffice",
  "calendar.createFocusBlock",
  "calendar.createBookingSchedule",
  "planner.composeDayPlan",
]);

export type CapabilityName = z.infer<typeof capabilityNameSchema>;

export const skillRiskLevelSchema = z.enum(["safe", "caution", "dangerous"]);

export const skillPlanStepSchema = z.object({
  id: z.string().min(1),
  description: z.string().min(1),
  capability: capabilityNameSchema.optional(),
  requiredSlots: z.array(z.string()).optional(),
}).strict();

export const skillSuccessCheckSchema = z.object({
  id: z.string().min(1),
  description: z.string().min(1),
}).strict();

export const skillFailureModeSchema = z.object({
  code: z.string().min(1),
  description: z.string().min(1),
  recoveryPrompt: z.string().min(1),
}).strict();

export const skillResponseTemplatesSchema = z.object({
  success: z.string().min(1),
  partial: z.string().min(1),
  blocked: z.string().min(1),
  failed: z.string().min(1),
}).strict();

const skillIdSchema = z.custom<SkillId>((value) => {
  return typeof value === "string" && (BASELINE_SKILL_IDS as readonly string[]).includes(value);
}, {
  message: "Unknown skill id",
});

export const skillContractSchema = z.object({
  id: skillIdSchema,
  intent_examples: z.array(z.string().min(1)).min(1),
  required_slots: z.array(z.string().min(1)),
  optional_slots: z.array(z.string().min(1)),
  allowed_tools: z.array(capabilityNameSchema).min(1),
  plan: z.array(skillPlanStepSchema).min(1),
  success_checks: z.array(skillSuccessCheckSchema).min(1),
  failure_modes: z.array(skillFailureModeSchema).min(1),
  user_response_templates: skillResponseTemplatesSchema,
  risk_level: skillRiskLevelSchema,
  requires_approval: z.boolean(),
  idempotency_scope: z.enum(["message", "thread", "conversation"]),
  supports_dry_run: z.boolean(),
  owner: z.string().min(1),
  version: z.string().min(1),
}).strict();

export type SkillContract = z.infer<typeof skillContractSchema>;

export function parseSkillContract(input: unknown): SkillContract {
  return skillContractSchema.parse(input);
}
