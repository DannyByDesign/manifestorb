import { type ModelMessage, type ToolSet } from "ai";
import type { createGenerateText } from "@/server/lib/llms";
import type { RuntimeCustomToolDefinition } from "@/server/features/ai/tools/harness/types";

type GenerateTextCall = Parameters<ReturnType<typeof createGenerateText>>[0];
type GenerateTextWithMaxSteps = (
  params: GenerateTextCall & { maxSteps?: number },
) => ReturnType<ReturnType<typeof createGenerateText>>;

function toAiSdkToolSet(customTools: RuntimeCustomToolDefinition[]): ToolSet {
  const tools: Record<string, ToolSet[string]> = {};
  for (const tool of customTools) {
    tools[tool.name] = {
      description: tool.description,
      inputSchema: tool.inputSchema,
      execute: tool.execute,
    };
  }
  return tools;
}

export async function runRuntimeSessionRunner(params: {
  generate: ReturnType<typeof createGenerateText>;
  model: GenerateTextCall["model"];
  system: string;
  messages: ModelMessage[];
  maxSteps: number;
  builtInTools: RuntimeCustomToolDefinition[];
  customTools: RuntimeCustomToolDefinition[];
  toolChoice?: GenerateTextCall["toolChoice"];
}) {
  const generateWithMaxSteps = params.generate as unknown as GenerateTextWithMaxSteps;
  const toolChoice = params.toolChoice;

  const tools =
    toolChoice === "none"
      ? undefined
      : toAiSdkToolSet([
          ...params.builtInTools,
          ...params.customTools,
        ]);

  return await generateWithMaxSteps({
    model: params.model,
    system: params.system,
    messages: params.messages,
    tools,
    toolChoice,
    maxSteps: params.maxSteps,
  });
}
