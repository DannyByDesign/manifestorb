import prisma from "@/server/db/client";
import { listApprovalRuleConfigs, type ApprovalPolicy } from "@/server/features/approvals/rules";

export interface SkillWorkingHoursPreference {
  workHourStart: number;
  workHourEnd: number;
  workDays: number[];
  timeZone: string;
}

export interface SkillApprovalPolicySummary {
  toolName: string;
  defaultPolicy: ApprovalPolicy;
  enabledRuleCount: number;
}

export interface SkillPolicyContext {
  userId: string;
  workingHours: SkillWorkingHoursPreference | null;
  approvalPolicies: SkillApprovalPolicySummary[];
}

export async function loadSkillPolicyContext(userId: string): Promise<SkillPolicyContext> {
  const [taskPreference, approvalConfigs] = await Promise.all([
    prisma.taskPreference.findUnique({
      where: { userId },
      select: {
        workHourStart: true,
        workHourEnd: true,
        workDays: true,
        timeZone: true,
      },
    }),
    listApprovalRuleConfigs({ userId }),
  ]);

  const workingHours =
    taskPreference &&
    typeof taskPreference.workHourStart === "number" &&
    typeof taskPreference.workHourEnd === "number"
      ? {
          workHourStart: taskPreference.workHourStart,
          workHourEnd: taskPreference.workHourEnd,
          workDays: Array.isArray(taskPreference.workDays)
            ? taskPreference.workDays
            : [1, 2, 3, 4, 5],
          timeZone: taskPreference.timeZone ?? "UTC",
        }
      : null;

  return {
    userId,
    workingHours,
    approvalPolicies: approvalConfigs.map((cfg) => ({
      toolName: cfg.toolName,
      defaultPolicy: cfg.defaultPolicy,
      enabledRuleCount: cfg.rules.filter((rule) => rule.enabled !== false).length,
    })),
  };
}

