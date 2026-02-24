import type { ToolSet } from "ai";
import { enforcePolicyForTool } from "@/server/features/ai/policy/enforcement";
import { assertProviderCompatibleToolSchema } from "@/server/features/ai/tools/fabric/adapters/provider-schema";
import type {
  RuntimeToolDefinition,
  ToolAssemblyContext,
  ToolExecutionArtifacts,
  ToolExecutionSummary,
} from "@/server/features/ai/tools/fabric/types";
import type { RuntimeToolResult } from "@/server/features/ai/tools/contracts/tool-result";

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

export interface RuntimeSessionTool {
  name: string;
  description: string;
  inputSchema: RuntimeToolDefinition["parameters"];
  execute: (rawArgs: unknown) => Promise<RuntimeToolResult>;
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

function timeoutResult(): RuntimeToolResult {
  return {
    success: false,
    error: "tool_timeout",
    message: "tool_timeout",
  };
}

function sanitizeResult(result: RuntimeToolResult): RuntimeToolResult {
  if (!result || typeof result !== "object") return result;
  if (!Array.isArray(result.data)) return result;
  return {
    ...result,
    meta: {
      ...result.meta,
      itemCount: result.data.length,
    },
  };
}

function blockedResult(params: {
  policyMessage: string;
  reasonCode: string;
  kind: "block" | "require_approval";
}): RuntimeToolResult {
  return {
    success: false,
    error: params.reasonCode,
    message: "tool_blocked",
    clarification: {
      kind: "permissions",
      prompt: params.kind === "require_approval" ? "tool_approval_required" : "tool_blocked",
    },
    data: {
      reasonCode: params.reasonCode,
      policyMessage: params.policyMessage,
    },
  };
}

function invalidToolArgsResult(
  definition: RuntimeToolDefinition,
  missingFields: string[],
): RuntimeToolResult {
  const fields = missingFields.length > 0 ? missingFields : ["tool_args"];
  return {
    success: false,
    error: "invalid_tool_arguments",
    message: "invalid_tool_arguments",
    clarification: {
      kind: "invalid_fields",
      prompt: "tool_invalid_arguments",
      missingFields: fields,
    },
    data: {
      toolName: definition.toolName,
    },
  };
}

function buildToolExecutor(params: {
  definition: RuntimeToolDefinition;
  context: ToolAssemblyContext;
  artifacts: ToolExecutionArtifacts;
  summaries: ToolExecutionSummary[];
}): (rawArgs: unknown) => Promise<RuntimeToolResult> {
  const { definition, context, artifacts, summaries } = params;

  return async (rawArgs: unknown): Promise<RuntimeToolResult> => {
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
      const result = blockedResult({
        policyMessage: policy.message,
        reasonCode: policy.reasonCode,
        kind: "block",
      });
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
      const result = blockedResult({
        policyMessage: policy.message,
        reasonCode: policy.reasonCode,
        kind: "require_approval",
      });
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

    let result: RuntimeToolResult;
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
        result = timeoutResult();
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

export function assembleRuntimeSessionTools(params: {
  registry: RuntimeToolDefinition[];
  context: ToolAssemblyContext;
  artifacts: ToolExecutionArtifacts;
  summaries: ToolExecutionSummary[];
}): {
  tools: RuntimeSessionTool[];
  toolLookup: Map<string, RuntimeSessionTool>;
} {
  const tools = params.registry.map((definition) => {
    assertProviderCompatibleToolSchema(
      definition.parameters,
      `tool:${definition.toolName}`,
    );
    return {
      name: definition.toolName,
      description: definition.description,
      inputSchema: definition.parameters,
      execute: buildToolExecutor({
        definition,
        context: params.context,
        artifacts: params.artifacts,
        summaries: params.summaries,
      }),
    } satisfies RuntimeSessionTool;
  });

  return {
    tools,
    toolLookup: new Map(tools.map((tool) => [tool.name, tool])),
  };
}

export function toAiToolSet(tools: RuntimeSessionTool[]): ToolSet {
  const toolSet: ToolSet = {};
  for (const tool of tools) {
    toolSet[tool.name] = {
      description: tool.description,
      inputSchema: tool.inputSchema,
      execute: tool.execute,
    };
  }
  return toolSet;
}
