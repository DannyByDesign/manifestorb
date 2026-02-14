import type { ToolSet } from "ai";
import { executeRuntimeTool } from "@/server/features/ai/tools/runtime/capabilities/execute";
import { enforcePolicyForTool } from "@/server/features/ai/policy/enforcement";
import { assertProviderCompatibleToolSchema } from "@/server/features/ai/tools/fabric/adapters/provider-schema";
import type {
  RuntimeToolDefinition,
  ToolAssemblyContext,
  ToolExecutionArtifacts,
  ToolExecutionSummary,
} from "@/server/features/ai/tools/fabric/types";
import type { ToolResult } from "@/server/features/ai/tools/types";

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

        const result = sanitizeResult(
          await executeRuntimeTool({
            toolName: definition.toolName as Parameters<typeof executeRuntimeTool>[0]["toolName"],
            args: policy.args,
            capabilities: params.context.capabilities,
          }),
        );

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
