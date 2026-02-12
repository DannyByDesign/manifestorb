import type { CapabilityName, SkillContract } from "@/server/features/ai/skills/contracts/skill-contract";
import type { ToolResult } from "@/server/features/ai/tools/types";

export type StepRunnerState = {
  lastQueriedEmailIds: string[];
};

export type StepRunnerOutput = {
  toolChain: CapabilityName[];
  toolResults: Record<string, ToolResult>;
  interactivePayloads: unknown[];
  stepsExecuted: number;
  state: StepRunnerState;
};

export function initStepRunnerState(): StepRunnerState {
  return { lastQueriedEmailIds: [] };
}

export async function runSkillSteps(params: {
  skill: SkillContract;
  executeCapability: (capability: CapabilityName, stepId: string) => Promise<ToolResult>;
  onStepResult?: (stepId: string, result: ToolResult) => void;
}): Promise<StepRunnerOutput> {
  const toolChain: CapabilityName[] = [];
  const toolResults: Record<string, ToolResult> = {};
  const interactivePayloads: unknown[] = [];
  let stepsExecuted = 0;
  const state = initStepRunnerState();

  for (const step of params.skill.plan) {
    stepsExecuted += 1;
    if (!step.capability) continue;
    toolChain.push(step.capability);
    const result = await params.executeCapability(step.capability, step.id);
    toolResults[step.id] = result;
    if (result.interactive) interactivePayloads.push(result.interactive);
    params.onStepResult?.(step.id, result);
  }

  return { toolChain, toolResults, interactivePayloads, stepsExecuted, state };
}

