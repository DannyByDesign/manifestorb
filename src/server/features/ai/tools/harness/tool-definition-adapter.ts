import { enforcePolicyForTool } from "@/server/features/ai/policy/enforcement";
import { assertProviderCompatibleToolSchema } from "@/server/features/ai/tools/fabric/adapters/provider-schema";
import type {
  RuntimeToolDefinition,
  ToolAssemblyContext,
  ToolExecutionArtifacts,
  ToolExecutionSummary,
} from "@/server/features/ai/tools/fabric/types";
import type { RuntimeCustomToolDefinition } from "@/server/features/ai/tools/harness/types";
import type { ToolResult } from "@/server/features/ai/tools/types";

const TOOL_EXECUTION_TIMEOUT_MS = 45_000;

class ToolExecutionTimeoutError extends Error {
  constructor(
    readonly toolName: string,
    readonly timeoutMs: number,
  ) {
    super(`tool_execution_timeout:${toolName}:${timeoutMs}`);
    this.name = "ToolExecutionTimeoutError";
  }
}

async function withToolTimeout<T>(params: {
  toolName: string;
  timeoutMs: number;
  run: () => Promise<T>;
}): Promise<T> {
  let timeoutHandle: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      params.run(),
      new Promise<T>((_resolve, reject) => {
        timeoutHandle = setTimeout(() => {
          reject(new ToolExecutionTimeoutError(params.toolName, params.timeoutMs));
        }, params.timeoutMs);
      }),
    ]);
  } finally {
    if (timeoutHandle) clearTimeout(timeoutHandle);
  }
}

function timeoutResult(toolName: string): ToolResult {
  return {
    success: false,
    error: "tool_timeout",
    message: `Tool ${toolName} took too long to respond. Please try again.`,
  };
}

function sanitizeResult(result: ToolResult): ToolResult {
  if (!result || typeof result !== "object") return result;
  if (!Array.isArray(result.data)) return result;
  return {
    ...result,
    meta: {
      ...result.meta,
      itemCount: Array.isArray(result.data) ? result.data.length : result.meta?.itemCount,
    },
  };
}

function blockedResult(message: string, code: string): ToolResult {
  return {
    success: false,
    error: code,
    message,
    clarification: {
      kind: "permissions",
      prompt: message,
    },
  };
}

function invalidToolArgsResult(
  definition: RuntimeToolDefinition,
  missingFields: string[],
): ToolResult {
  const fields = missingFields.length > 0 ? missingFields : ["tool_args"];
  return {
    success: false,
    error: "invalid_tool_arguments",
    message: `Tool ${definition.toolName} received invalid arguments.`,
    clarification: {
      kind: "invalid_fields",
      prompt: `I need valid arguments to run ${definition.toolName}.`,
      missingFields: fields,
    },
  };
}

function buildToolExecutor(params: {
  definition: RuntimeToolDefinition;
  context: ToolAssemblyContext;
  artifacts: ToolExecutionArtifacts;
  summaries: ToolExecutionSummary[];
}): (rawArgs: unknown) => Promise<ToolResult> {
  const { definition, context, artifacts, summaries } = params;

  return async (rawArgs: unknown): Promise<ToolResult> => {
    const startedAt = Date.now();
    const args =
      rawArgs && typeof rawArgs === "object" && !Array.isArray(rawArgs)
        ? (rawArgs as Record<string, unknown>)
        : {};

    const policy = await enforcePolicyForTool({
      context: context.policy,
      toolName: definition.toolName,
      args,
      definition: definition.metadata,
    });

    if (policy.kind === "block") {
      const result = blockedResult(policy.message, policy.reasonCode);
      summaries.push({
        toolName: definition.toolName,
        outcome: "blocked",
        durationMs: Date.now() - startedAt,
        result,
      });
      return result;
    }

    if (policy.kind === "require_approval") {
      artifacts.approvals.push(policy.approval);
      const result = blockedResult(policy.message, policy.reasonCode);
      summaries.push({
        toolName: definition.toolName,
        outcome: "blocked",
        durationMs: Date.now() - startedAt,
        result,
      });
      return result;
    }

    const parsedArgs = definition.parameters.safeParse(policy.args);
    if (!parsedArgs.success) {
      const missingFields = parsedArgs.error.issues
        .map((issue) => issue.path.join("."))
        .filter((field) => field.length > 0);
      const result = invalidToolArgsResult(definition, missingFields);
      summaries.push({
        toolName: definition.toolName,
        outcome: "failed",
        durationMs: Date.now() - startedAt,
        result,
      });
      return result;
    }

    let result: ToolResult;
    try {
      result = sanitizeResult(
        await withToolTimeout({
          toolName: definition.toolName,
          timeoutMs: TOOL_EXECUTION_TIMEOUT_MS,
          run: () =>
            definition.execute({
              args:
                parsedArgs.data &&
                typeof parsedArgs.data === "object" &&
                !Array.isArray(parsedArgs.data)
                  ? (parsedArgs.data as Record<string, unknown>)
                  : {},
              capabilities: context.capabilities,
            }),
        }),
      );
    } catch (error) {
      if (error instanceof ToolExecutionTimeoutError) {
        result = timeoutResult(definition.toolName);
      } else {
        throw error;
      }
    }

    if (result.interactive) {
      artifacts.interactivePayloads.push(result.interactive);
    }

    summaries.push({
      toolName: definition.toolName,
      outcome: result.success ? "success" : "failed",
      durationMs: Date.now() - startedAt,
      result,
    });

    return result;
  };
}

export function toToolDefinitions(params: {
  registry: RuntimeToolDefinition[];
  context: ToolAssemblyContext;
  artifacts: ToolExecutionArtifacts;
  summaries: ToolExecutionSummary[];
}): RuntimeCustomToolDefinition[] {
  return params.registry.map((definition) => {
    assertProviderCompatibleToolSchema(
      definition.parameters,
      `tool:${definition.toolName}`,
    );
    const execute = buildToolExecutor({
      definition,
      context: params.context,
      artifacts: params.artifacts,
      summaries: params.summaries,
    });
    return {
      name: definition.toolName,
      label: definition.toolName,
      description: definition.description,
      inputSchema: definition.parameters,
      execute,
    };
  });
}
