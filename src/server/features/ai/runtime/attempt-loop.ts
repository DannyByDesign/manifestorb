import type { RuntimeSession } from "@/server/features/ai/runtime/types";
import type { RuntimeLoopResult } from "@/server/features/ai/runtime/response-contract";
import { generateRuntimeDecision } from "@/server/features/ai/runtime/decision/generate";
import { validateRuntimeDecision } from "@/server/features/ai/runtime/decision/validate";
import { repairRuntimeDecisionArgs } from "@/server/features/ai/runtime/decision/repair";
import { buildRuntimeTurnContext, executeToolCall } from "@/server/features/ai/runtime/tool-runtime";
import { summarizeRuntimeResults } from "@/server/features/ai/runtime/result-summarizer";
import type { RuntimeToolResult } from "@/server/features/ai/tools/contracts/tool-result";
import type { ValidatedToolDecision } from "@/server/features/ai/runtime/decision/schema";

const MAX_RUNTIME_ATTEMPTS = 6;

export async function runAttemptLoop(session: RuntimeSession): Promise<RuntimeLoopResult> {
  const context = buildRuntimeTurnContext(session);
  const results: RuntimeToolResult[] = [];

  for (let attempt = 1; attempt <= MAX_RUNTIME_ATTEMPTS; attempt += 1) {
    const decision = await generateRuntimeDecision({
      session,
      executedResults: results,
      attempt,
    });

    let validated = validateRuntimeDecision({ decision, session });

    if (!validated.ok && validated.toolName) {
      const repairedArgsJson = await repairRuntimeDecisionArgs({
        session,
        toolName: validated.toolName,
        previousArgsJson: validated.argsJson,
        validationReason: validated.reason,
      });

      if (repairedArgsJson) {
        validated = validateRuntimeDecision({
          decision: {
            type: "tool_call",
            toolName: validated.toolName,
            argsJson: repairedArgsJson,
            rationale: decision.rationale,
          },
          session,
        });
      }
    }

    if (!validated.ok) {
      if (attempt >= MAX_RUNTIME_ATTEMPTS) {
        return {
          text: "I need one more detail before I can continue. Please restate the request in one sentence with the exact outcome you want.",
          stopReason: "needs_clarification",
          attempts: attempt,
        };
      }
      continue;
    }

    const resolvedDecision = validated.decision;

    if (resolvedDecision.type === "respond") {
      return {
        text: resolvedDecision.responseText?.trim() || "Completed.",
        stopReason: "completed",
        attempts: attempt,
      };
    }

    if (resolvedDecision.type === "clarify") {
      return {
        text:
          resolvedDecision.responseText?.trim() ||
          "I need one more detail to proceed. What exact change should I make?",
        stopReason: "needs_clarification",
        attempts: attempt,
      };
    }

    if (!("args" in resolvedDecision)) {
      continue;
    }

    const result = await executeToolCall({
      context,
      decision: resolvedDecision as ValidatedToolDecision,
    });

    results.push(result);

    if (result.clarification?.prompt) {
      return {
        text: result.clarification.prompt,
        stopReason: "needs_clarification",
        attempts: attempt,
      };
    }

    if (context.session.artifacts.approvals.length > 0) {
      return {
        text: summarizeRuntimeResults({
          request: session.input.message,
          results,
          approvalsCount: context.session.artifacts.approvals.length,
        }),
        stopReason: "approval_pending",
        attempts: attempt,
      };
    }

    if (result.success && attempt >= 2) {
      return {
        text: summarizeRuntimeResults({
          request: session.input.message,
          results,
          approvalsCount: context.session.artifacts.approvals.length,
        }),
        stopReason: "completed",
        attempts: attempt,
      };
    }
  }

  return {
    text: summarizeRuntimeResults({
      request: session.input.message,
      results,
      approvalsCount: session.artifacts.approvals.length,
    }),
    stopReason: "max_attempts",
    attempts: MAX_RUNTIME_ATTEMPTS,
  };
}
