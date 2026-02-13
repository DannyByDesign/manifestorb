import { z } from "zod";
import { createGenerateObject } from "@/server/lib/llms";
import { getModel } from "@/server/lib/llms/model";
import type { RuntimeSession } from "@/server/features/ai/runtime/types";
import type {
  RuntimeExecutionPlan,
  RuntimePlannerDraftStep,
  RuntimePlanIntent,
} from "@/server/features/ai/runtime/planner/types";
import { validateRuntimeDraftPlan } from "@/server/features/ai/runtime/planner/validator";

const planSchema = z
  .object({
    intent: z.enum(["read", "mutate", "mixed", "unknown"]).default("unknown"),
    confidence: z.number().min(0).max(1).default(0.5),
    needsClarification: z.string().max(320).optional(),
    steps: z
      .array(
        z
          .object({
            capabilityId: z.string().min(1),
            argsJson: z.string().min(2).max(12_000),
            rationale: z.string().max(320).optional(),
          })
          .strict(),
      )
      .max(8)
      .default([]),
  })
  .strict();

const repairSchema = z
  .object({
    repairs: z
      .array(
        z
          .object({
            index: z.number().int().nonnegative(),
            argsJson: z.string().min(2).max(12_000),
          })
          .strict(),
      )
      .max(8)
      .default([]),
  })
  .strict();

function formatCapabilityCatalog(session: RuntimeSession): string {
  return session.toolRegistry
    .map((tool) => {
      const families = tool.metadata.intentFamilies.join(",");
      const mode = tool.metadata.readOnly ? "read_only" : "mutating";
      const risk = tool.metadata.riskLevel;
      return `- ${tool.capabilityId} | ${mode} | risk=${risk} | families=${families} | ${tool.description}`;
    })
    .join("\n");
}

function buildPlannerSystemPrompt(): string {
  return [
    "You are the runtime planner for Amodel.",
    "Return JSON only.",
    "Select a small set of executable capability steps for the current user request.",
    "Each step MUST use one capabilityId from the provided catalog.",
    "For each step, argsJson MUST be a valid JSON object string.",
    "Do not include markdown, commentary, or prose outside JSON.",
  ].join("\n");
}

function normalizeIntent(value: string): RuntimePlanIntent {
  if (value === "read" || value === "mutate" || value === "mixed") return value;
  return "unknown";
}

function heuristicPlan(session: RuntimeSession): RuntimeExecutionPlan {
  const message = session.input.message.toLowerCase();
  const capabilities = new Set(session.toolRegistry.map((tool) => tool.capabilityId));

  const steps: RuntimePlannerDraftStep[] = [];
  if (
    (message.includes("inbox") || message.includes("email")) &&
    capabilities.has("email.searchInbox")
  ) {
    steps.push({
      capabilityId: "email.searchInbox",
      argsJson: JSON.stringify({ query: "in:inbox", limit: 25 }),
      rationale: "Initial inbox retrieval for read request.",
    });
  } else if (
    message.includes("calendar") &&
    capabilities.has("calendar.listEvents")
  ) {
    steps.push({
      capabilityId: "calendar.listEvents",
      argsJson: JSON.stringify({}),
      rationale: "Initial calendar retrieval for read request.",
    });
  }

  const validation = validateRuntimeDraftPlan({
    draftSteps: steps,
    registry: session.toolRegistry,
  });

  return {
    intent: "unknown",
    confidence: 0.3,
    source: steps.length > 0 ? "heuristic" : "none",
    steps: validation.validSteps,
    issues: validation.issues,
  };
}

async function repairInvalidSteps(params: {
  session: RuntimeSession;
  draftSteps: RuntimePlannerDraftStep[];
  invalidIssues: Array<{ index: number; capabilityId: string; reason: string }>;
}): Promise<RuntimePlannerDraftStep[]> {
  const generateRepair = createGenerateObject({
    emailAccount: {
      id: params.session.input.emailAccountId,
      email: params.session.input.email,
      userId: params.session.input.userId,
    },
    label: "openworld-runtime-planner-repair",
    modelOptions: getModel("economy"),
  });

  const repairResult = await generateRepair({
    model: getModel("economy").model,
    schema: repairSchema,
    system: [
      "Return JSON only.",
      "Fix invalid argsJson values for the specified plan step indexes.",
      "Do not change capabilityId and do not add extra indexes.",
      "Each argsJson must be a JSON object string.",
    ].join("\n"),
    prompt: [
      `User request: ${params.session.input.message}`,
      "Capability catalog:",
      formatCapabilityCatalog(params.session),
      "Draft plan steps JSON:",
      JSON.stringify(params.draftSteps),
      "Invalid step issues JSON:",
      JSON.stringify(params.invalidIssues),
      'Return {"repairs":[{"index":number,"argsJson":"{...}"}]}',
    ].join("\n\n"),
  });

  const patched = params.draftSteps.map((step) => ({ ...step }));
  for (const repair of repairResult.object.repairs) {
    if (repair.index < 0 || repair.index >= patched.length) continue;
    patched[repair.index] = {
      ...patched[repair.index]!,
      argsJson: repair.argsJson,
    };
  }
  return patched;
}

export async function buildRuntimeExecutionPlan(
  session: RuntimeSession,
): Promise<RuntimeExecutionPlan> {
  if (session.toolRegistry.length === 0) {
    return {
      intent: "unknown",
      confidence: 0,
      source: "none",
      steps: [],
      issues: [],
    };
  }

  const generatePlan = createGenerateObject({
    emailAccount: {
      id: session.input.emailAccountId,
      email: session.input.email,
      userId: session.input.userId,
    },
    label: "openworld-runtime-planner",
    modelOptions: getModel("economy"),
  });

  try {
    const response = await generatePlan({
      model: getModel("economy").model,
      schema: planSchema,
      system: buildPlannerSystemPrompt(),
      prompt: [
        `User request: ${session.input.message}`,
        "Capability catalog:",
        formatCapabilityCatalog(session),
        "Return JSON with fields: intent, confidence, needsClarification, steps[].",
      ].join("\n\n"),
    });

    const draftSteps: RuntimePlannerDraftStep[] = response.object.steps;
    const firstPass = validateRuntimeDraftPlan({
      draftSteps,
      registry: session.toolRegistry,
    });

    if (firstPass.issues.length === 0) {
      return {
        intent: normalizeIntent(response.object.intent),
        confidence: response.object.confidence,
        needsClarification: response.object.needsClarification,
        source: "llm_plan",
        steps: firstPass.validSteps,
        issues: [],
      };
    }

    const repairedDraftSteps = await repairInvalidSteps({
      session,
      draftSteps,
      invalidIssues: firstPass.issues,
    });
    const secondPass = validateRuntimeDraftPlan({
      draftSteps: repairedDraftSteps,
      registry: session.toolRegistry,
    });

    return {
      intent: normalizeIntent(response.object.intent),
      confidence: response.object.confidence,
      needsClarification: response.object.needsClarification,
      source: secondPass.validSteps.length > 0 ? "llm_plan_repaired" : "heuristic",
      steps:
        secondPass.validSteps.length > 0
          ? secondPass.validSteps
          : heuristicPlan(session).steps,
      issues: secondPass.issues,
    };
  } catch (error) {
    session.input.logger.warn("Runtime planner failed; falling back to heuristic plan", {
      error,
      userId: session.input.userId,
      provider: session.input.provider,
    });
    return heuristicPlan(session);
  }
}

