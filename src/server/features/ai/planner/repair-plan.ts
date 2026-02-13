import type { Logger } from "@/server/lib/logger";
import { createGenerateObject } from "@/server/lib/llms";
import { getModel } from "@/server/lib/llms/model";
import { plannerPlanSchema } from "@/server/features/ai/planner/plan-schema";
import type { PlannerPlan, PlannerValidationIssue } from "@/server/features/ai/planner/types";
import type { CapabilityName } from "@/server/features/ai/skills/contracts/skill-contract";
import { getCapabilityDefinition } from "@/server/features/ai/capabilities/registry";

function renderCapabilityMenu(capabilities: CapabilityName[]): string {
  return capabilities
    .map((capability) => {
      const def = getCapabilityDefinition(capability);
      return `- ${def.id}: ${def.description}`;
    })
    .join("\n");
}

function renderIssues(issues: PlannerValidationIssue[]): string {
  return issues
    .map((issue, index) => `${index + 1}. [${issue.code}] ${issue.message}`)
    .join("\n");
}

export async function repairPlannerPlan(params: {
  logger: Logger;
  emailAccount: { id: string; email: string; userId: string };
  message: string;
  candidateCapabilities: CapabilityName[];
  priorPlan: PlannerPlan;
  issues: PlannerValidationIssue[];
}): Promise<PlannerPlan> {
  const modelOptions = getModel();
  const generateObject = createGenerateObject({
    emailAccount: params.emailAccount,
    label: "Capability planner repair pass",
    modelOptions,
  });

  const capabilityMenu = renderCapabilityMenu(params.candidateCapabilities);
  const issueText = renderIssues(params.issues);

  const { object } = await generateObject({
    ...modelOptions,
    schema: plannerPlanSchema,
    prompt: `Repair the invalid execution plan.

Constraints:
- Use only capabilities listed below.
- Fix all validation issues.
- Keep plan concise (1-8 steps).
- Preserve user intent.

User request:
${params.message.trim()}

Capabilities:
${capabilityMenu}

Invalid plan:
${JSON.stringify(params.priorPlan, null, 2)}

Validation issues:
${issueText}
`,
  });

  return plannerPlanSchema.parse(object);
}
