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

export async function executeToolCall(params: {
  context: RuntimeTurnContext;
  decision: RuntimeToolCall;
}): Promise<RuntimeToolResult> {
  const { context, decision } = params;
  const tool = context.session.tools[decision.toolName as keyof typeof context.session.tools] as
    | { execute?: (args: Record<string, unknown>) => Promise<RuntimeToolResult> }
    | undefined;

  if (!tool?.execute) {
    return {
      success: false,
      error: `unsupported_tool:${decision.toolName}`,
      message: `Tool ${decision.toolName} is not available in this runtime session.`,
    };
  }

  try {
    return await tool.execute(decision.args);
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
