import type { OpenWorldTurnInput } from "@/server/features/ai/runtime/types";
import { evaluateRuntimeContextRequirements } from "@/server/features/ai/runtime/context/requirements";

export interface RuntimePrecheckResult {
  ok: boolean;
  issues: string[];
  userMessage?: string;
}

export function runRuntimePrecheck(input: OpenWorldTurnInput): RuntimePrecheckResult {
  const issues = evaluateRuntimeContextRequirements(input);
  if (issues.length === 0) {
    return { ok: true, issues: [] };
  }

  return {
    ok: false,
    issues: issues.map((issue) => issue.key),
    userMessage:
      "I’m missing required context to execute that request. Please reconnect your account and retry.",
  };
}
