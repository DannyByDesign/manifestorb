import type { ToolSet } from "ai";
import { enforcePolicyForTool } from "@/server/features/ai/policy/enforcement";
import { assertProviderCompatibleToolSchema } from "@/server/features/ai/tools/fabric/adapters/provider-schema";
import type {
  RuntimeToolDefinition,
  ToolAssemblyContext,
  ToolExecutionArtifacts,
  ToolExecutionSummary,
} from "@/server/features/ai/tools/fabric/types";
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

function truncateArray(value: unknown[], maxItems = 20): unknown[] {
  if (value.length <= maxItems) return value;
  return [...value.slice(0, maxItems), { truncated: true, omitted: value.length - maxItems }];
}

function sanitizeResult(result: ToolResult): ToolResult {
  if (!result || typeof result !== "object") return result;
  if (!Array.isArray(result.data)) return result;
  return {
    ...result,
    data: truncateArray(result.data, 20),
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

export function assembleRuntimeTools(params: {
  registry: RuntimeToolDefinition[];
  context: ToolAssemblyContext;
  artifacts: ToolExecutionArtifacts;
  summaries: ToolExecutionSummary[];
}): ToolSet {
  const tools: Record<string, ToolSet[string]> = {};

  for (const definition of params.registry) {
    assertProviderCompatibleToolSchema(
      definition.parameters,
      `tool:${definition.toolName}`,
    );

    tools[definition.toolName] = {
      description: definition.description,
      inputSchema: definition.parameters,
      execute: async (rawArgs: unknown) => {
        const startedAt = Date.now();
        const args =
          rawArgs && typeof rawArgs === "object" && !Array.isArray(rawArgs)
            ? (rawArgs as Record<string, unknown>)
            : {};

        const policy = await enforcePolicyForTool({
          context: params.context.policy,
          toolName: definition.toolName,
          args,
          definition: definition.metadata,
        });

        if (policy.kind === "block") {
          const result = blockedResult(policy.message, policy.reasonCode);
          params.summaries.push({
            toolName: definition.toolName,
            outcome: "blocked",
            durationMs: Date.now() - startedAt,
            result,
          });
          return result;
        }

        if (policy.kind === "require_approval") {
          params.artifacts.approvals.push(policy.approval);
          const result = blockedResult(policy.message, policy.reasonCode);
          params.summaries.push({
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
          params.summaries.push({
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
                  capabilities: params.context.capabilities,
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
          params.artifacts.interactivePayloads.push(result.interactive);
        }

        params.summaries.push({
          toolName: definition.toolName,
          outcome: result.success ? "success" : "failed",
          durationMs: Date.now() - startedAt,
          result,
        });

        return result;
      },
    };
  }

  return tools;
}
