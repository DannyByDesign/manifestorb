import type { StepResult, ToolSet } from "ai";
import type { RuntimeSession } from "@/server/features/ai/runtime/types";
import { emitRuntimeTelemetry } from "@/server/features/ai/runtime/telemetry/schema";

function classifyToolOutcome(output: unknown): "success" | "blocked" | "failed" | "unknown" {
  if (!output || typeof output !== "object") return "unknown";
  const result = output as Record<string, unknown>;
  if (result.success === true) return "success";
  if (result.success === false) {
    const error = typeof result.error === "string" ? result.error : "";
    if (
      error.includes("permission") ||
      error.includes("approval") ||
      error.includes("blocked")
    ) {
      return "blocked";
    }
    return "failed";
  }
  return "unknown";
}

export function emitToolLifecycleEvents(params: {
  session: RuntimeSession;
  steps: Array<StepResult<ToolSet>>;
}): void {
  const { session, steps } = params;

  steps.forEach((step, index) => {
    const stepIndex = index + 1;

    for (const toolCall of step.toolCalls) {
      emitRuntimeTelemetry(session.input.logger, "openworld.runtime.tool_lifecycle", {
        userId: session.input.userId,
        provider: session.input.provider,
        phase: "start",
        toolName: toolCall.toolName,
        toolCallId: toolCall.toolCallId,
        stepIndex,
      });

      emitRuntimeTelemetry(session.input.logger, "openworld.runtime.tool_lifecycle", {
        userId: session.input.userId,
        provider: session.input.provider,
        phase: "update",
        toolName: toolCall.toolName,
        toolCallId: toolCall.toolCallId,
        stepIndex,
      });

      const matchingResult = step.toolResults.find(
        (result) => result.toolCallId === toolCall.toolCallId,
      );

      if (matchingResult) {
        emitRuntimeTelemetry(session.input.logger, "openworld.runtime.tool_lifecycle", {
          userId: session.input.userId,
          provider: session.input.provider,
          phase: "result",
          toolName: matchingResult.toolName,
          toolCallId: matchingResult.toolCallId,
          stepIndex,
          outcome: classifyToolOutcome(matchingResult.output),
        });
      }
    }
  });
}
