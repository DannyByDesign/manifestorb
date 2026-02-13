import type { Logger } from "@/server/lib/logger";
import { createGenerateObject } from "@/server/lib/llms";
import { getModel } from "@/server/lib/llms/model";
import { plannerPlanSchema } from "@/server/features/ai/planner/plan-schema";
import type { PlannerPlan, PlannerValidationIssue } from "@/server/features/ai/planner/types";
import type { CapabilityName } from "@/server/features/ai/skills/contracts/skill-contract";
import { getCapabilityDefinition } from "@/server/features/ai/capabilities/registry";
import { z } from "zod";
import { registerProviderSchema } from "@/server/lib/llms/schema-safety";

const CAPABILITY_PLANNER_REPAIR_SCHEMA_ID = "capability_planner_repair_v2";

const plannerRepairModelSchema = z
  .object({
    goal: z.string().min(1),
    steps: z
      .array(
        z
          .object({
            id: z.string().min(1),
            capability: z.string().min(1),
            argsJson: z.string().min(2),
            dependsOn: z.array(z.string().min(1)).optional(),
            postcondition: z.string().min(1).optional(),
            risk: z.enum(["safe", "caution", "dangerous"]).optional(),
          })
          .strict(),
      )
      .min(1)
      .max(12),
  })
  .strict();

registerProviderSchema({
  id: CAPABILITY_PLANNER_REPAIR_SCHEMA_ID,
  owner: "ai-runtime",
  route: "planner",
  label: "Capability planner repair pass",
  schema: plannerRepairModelSchema,
});

function parseArgsJson(raw: string): Record<string, unknown> {
  try {
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>;
    }
  } catch {
    // fall through
  }
  return {};
}

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
    schema: plannerRepairModelSchema,
    prompt: `Repair the invalid execution plan.

Constraints:
- Use only capabilities listed below.
- Fix all validation issues.
- Keep plan concise (1-8 steps).
- Preserve user intent.
- Return args as "argsJson" string containing a JSON object.
- Schema ID: ${CAPABILITY_PLANNER_REPAIR_SCHEMA_ID}

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

  return plannerPlanSchema.parse({
    goal: object.goal,
    steps: object.steps.map((step) => ({
      id: step.id,
      capability: step.capability,
      args: parseArgsJson(step.argsJson),
      dependsOn: step.dependsOn,
      postcondition: step.postcondition,
      risk: step.risk,
    })),
  });
}
