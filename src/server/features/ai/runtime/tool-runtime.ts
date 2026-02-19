import type { RuntimeSession } from "@/server/features/ai/runtime/types";
import type { RuntimeToolResult } from "@/server/features/ai/tools/contracts/tool-result";

export interface RuntimeTurnContext {
  session: RuntimeSession;
}

export interface RuntimeToolCall {
  toolName: string;
  args: Record<string, unknown>;
}

export function buildRuntimeTurnContext(session: RuntimeSession): RuntimeTurnContext {
  return { session };
}

function sanitizeRuntimeToolResult(result: RuntimeToolResult): RuntimeToolResult {
  // Keep tool-layer messages only for hard error paths. For successful or
  // clarification turns, response-writer should generate user-facing language.
  if (result.success || result.clarification) {
    if (result.message === undefined) return result;
    const sanitized = { ...result };
    delete sanitized.message;
    return sanitized;
  }
  return result;
}

export async function executeToolCall(params: {
  context: RuntimeTurnContext;
  decision: RuntimeToolCall;
}): Promise<RuntimeToolResult> {
  const { context, decision } = params;
  const tool = context.session.toolHarness.toolLookup.get(decision.toolName);

  if (!tool) {
    return {
      success: false,
      error: `unsupported_tool:${decision.toolName}`,
      message: `Tool ${decision.toolName} is not available in this runtime session.`,
    };
  }

  try {
    const result = await tool.execute(decision.args);
    return sanitizeRuntimeToolResult(result);
  } catch (error) {
    return {
      success: false,
      error: "tool_execution_failed",
      message:
        error instanceof Error
          ? `Tool ${decision.toolName} failed: ${error.message}`
          : `Tool ${decision.toolName} failed due to an unknown runtime error.`,
    };
  }
}
