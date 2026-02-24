import { type ModelMessage, type ToolSet } from "ai";
import type { createGenerateText } from "@/server/lib/llms";
import { toAiToolSet, type RuntimeSessionTool } from "@/server/features/ai/runtime/runtime-tools";

type GenerateTextCall = Parameters<ReturnType<typeof createGenerateText>>[0];
type GenerateTextWithMaxSteps = (
  params: GenerateTextCall & { maxSteps?: number },
) => ReturnType<ReturnType<typeof createGenerateText>>;

export async function runRuntimeSessionRunner(params: {
  generate: ReturnType<typeof createGenerateText>;
  model: GenerateTextCall["model"];
  system: string;
  messages: ModelMessage[];
  maxSteps: number;
  tools: RuntimeSessionTool[];
  toolChoice?: GenerateTextCall["toolChoice"];
}) {
  const generateWithMaxSteps = params.generate as unknown as GenerateTextWithMaxSteps;
  const toolChoice = params.toolChoice;

  const tools =
    toolChoice === "none"
      ? undefined
      : (toAiToolSet(params.tools) as ToolSet);

  return await generateWithMaxSteps({
    model: params.model,
    system: params.system,
    messages: params.messages,
    tools,
    toolChoice,
    maxSteps: params.maxSteps,
  });
}
