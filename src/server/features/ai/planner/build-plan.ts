import { z } from "zod";
import type { Logger } from "@/server/lib/logger";
import { createGenerateObject } from "@/server/lib/llms";
import { getModel } from "@/server/lib/llms/model";
import { plannerPlanSchema } from "@/server/features/ai/planner/plan-schema";
import type { PlannerPlan } from "@/server/features/ai/planner/types";
import type { CapabilityName } from "@/server/features/ai/skills/contracts/skill-contract";
import { getCapabilityDefinition } from "@/server/features/ai/capabilities/registry";

const modelPlanSchema = z.object({
  goal: z.string().min(1),
  steps: plannerPlanSchema.shape.steps,
}).strict();

function renderCapabilityMenu(capabilities: CapabilityName[]): string {
  return capabilities
    .map((capability) => {
      const def = getCapabilityDefinition(capability);
      return [
        `Capability: ${def.id}`,
        `Description: ${def.description}`,
        `ReadOnly: ${def.readOnly}`,
        `Risk: ${def.riskLevel}`,
        `ApprovalOperation: ${def.approvalOperation}`,
      ].join("\n");
    })
    .join("\n\n");
}

export async function buildPlannerPlan(params: {
  logger: Logger;
  emailAccount: { id: string; email: string; userId: string };
  message: string;
  candidateCapabilities: CapabilityName[];
}): Promise<PlannerPlan> {
  const modelOptions = getModel();
  const generateObject = createGenerateObject({
    emailAccount: params.emailAccount,
    label: "Capability planner (long-tail fallback)",
    modelOptions,
  });

  const capabilityMenu = renderCapabilityMenu(params.candidateCapabilities);

  const { object } = await generateObject({
    ...modelOptions,
    schema: modelPlanSchema,
    prompt: `You are building a deterministic execution plan for an inbox/calendar assistant.

Rules:
- Use only capabilities in the menu below.
- Return 1-8 steps.
- Keep args schema-shaped and explicit.
- Use dependsOn only when a step needs outputs from earlier steps.
- Prefer read operations before mutation when uncertain.
- Do not include redundant steps.

User request:
${params.message.trim()}

Candidate capabilities:
${capabilityMenu}
`,
  });

  return plannerPlanSchema.parse(object);
}
