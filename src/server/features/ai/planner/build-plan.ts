import { z } from "zod";
import type { Logger } from "@/server/lib/logger";
import { createGenerateObject } from "@/server/lib/llms";
import { getModel } from "@/server/lib/llms/model";
import { plannerPlanSchema } from "@/server/features/ai/planner/plan-schema";
import type { PlannerPlan } from "@/server/features/ai/planner/types";
import type { CapabilityName } from "@/server/features/ai/skills/contracts/skill-contract";
import { getCapabilityDefinition } from "@/server/features/ai/capabilities/registry";
import { registerProviderSchema } from "@/server/lib/llms/schema-safety";

const CAPABILITY_PLANNER_SCHEMA_ID = "capability_planner_v2";

const modelPlanSchema = z.object({
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
}).strict();

registerProviderSchema({
  id: CAPABILITY_PLANNER_SCHEMA_ID,
  owner: "ai-runtime",
  route: "planner",
  label: "Capability planner (long-tail fallback)",
  schema: modelPlanSchema,
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
- For each step, provide "argsJson" as a JSON object encoded as a string.
- argsJson must be a valid object string, for example: "{\\"ids\\":[\\"abc\\"],\\"read\\":true}".
- Use dependsOn only when a step needs outputs from earlier steps.
- Prefer read operations before mutation when uncertain.
- Do not include redundant steps.
- Schema ID: ${CAPABILITY_PLANNER_SCHEMA_ID}

User request:
${params.message.trim()}

Candidate capabilities:
${capabilityMenu}
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
