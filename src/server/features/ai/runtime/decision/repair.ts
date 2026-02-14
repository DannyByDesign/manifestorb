import { z } from "zod";
import { createGenerateObject } from "@/server/lib/llms";
import { getModel } from "@/server/lib/llms/model";
import type { RuntimeSession } from "@/server/features/ai/runtime/types";

const repairSchema = z
  .object({
    argsJson: z.string().min(2).max(12000),
  })
  .strict();

export async function repairRuntimeDecisionArgs(params: {
  session: RuntimeSession;
  toolName: string;
  previousArgsJson?: string;
  validationReason: string;
}): Promise<string | null> {
  const { session, toolName, previousArgsJson, validationReason } = params;
  const tool = session.toolLookup.get(toolName);
  if (!tool) return null;

  const generate = createGenerateObject({
    emailAccount: {
      id: session.input.emailAccountId,
      email: session.input.email,
      userId: session.input.userId,
    },
    label: "openworld-runtime-decision-repair",
    modelOptions: getModel("economy"),
    maxLLMRetries: 0,
  });

  const result = await generate({
    model: getModel("economy").model,
    schema: repairSchema,
    system: [
      "Return JSON only.",
      "Repair argsJson for one tool call.",
      "Output argsJson as a JSON object string valid for the provided tool schema.",
    ].join("\n"),
    prompt: [
      `User request: ${session.input.message}`,
      `Tool name: ${toolName}`,
      `Tool description: ${tool.description}`,
      `Validation issue: ${validationReason}`,
      `Previous argsJson: ${previousArgsJson ?? "{}"}`,
      'Return {"argsJson":"{...}"}',
    ].join("\n\n"),
  });

  return result.object.argsJson;
}
