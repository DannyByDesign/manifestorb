import { z } from "zod";
import { createGenerateObject } from "@/server/lib/llms";
import { getModel } from "@/server/lib/llms/model";
import { buildAgentSystemPrompt, type Platform } from "@/server/features/ai/system-prompt";
import type { RuntimeSession } from "@/server/features/ai/runtime/types";
import type { RuntimeToolResult } from "@/server/features/ai/tools/contracts/tool-result";
import { env } from "@/env";

const runtimeResponseSchema = z
  .object({
    responseText: z.string().min(1).max(4000),
  })
  .strict();

function compact(value: unknown, depth = 0): unknown {
  if (depth > 2) return typeof value === "object" ? "[truncated]" : value;
  if (Array.isArray(value)) {
    const out = value.slice(0, 4).map((item) => compact(item, depth + 1));
    if (value.length > 4) out.push({ truncated: true, omitted: value.length - 4 });
    return out;
  }
  if (!value || typeof value !== "object") return value;
  const obj = value as Record<string, unknown>;
  const out: Record<string, unknown> = {};
  for (const [key, entry] of Object.entries(obj).slice(0, 10)) {
    out[key] = compact(entry, depth + 1);
  }
  return out;
}

function toPlatform(provider: string): Platform {
  if (provider === "slack" || provider === "discord" || provider === "telegram") {
    return provider;
  }
  return "web";
}

function formatEvidence(results: RuntimeToolResult[]): string {
  if (results.length === 0) return "[]";
  const payload = results.slice(-6).map((result) => ({
    success: result.success,
    message: result.message ?? null,
    error: result.error ?? null,
    clarification: result.clarification ?? null,
    data: compact(result.data),
  }));
  return JSON.stringify(payload);
}

export async function generateRuntimeUserReply(params: {
  session: RuntimeSession;
  request: string;
  results: RuntimeToolResult[];
  approvalsCount: number;
  mode: "final" | "clarification" | "approval_pending" | "error";
  fallbackText: string;
}): Promise<string> {
  const { session, request, results, approvalsCount, mode, fallbackText } = params;
  const modelOptions = getModel("economy");
  const generate = createGenerateObject({
    emailAccount: {
      id: session.input.emailAccountId,
      email: session.input.email,
      userId: session.input.userId,
    },
    label: "openworld-runtime-response-write",
    modelOptions,
    maxLLMRetries: 0,
  });

  const systemPrompt = buildAgentSystemPrompt({
    platform: toPlatform(session.input.provider),
    emailSendEnabled: env.NEXT_PUBLIC_EMAIL_SEND_ENABLED,
    userConfig: session.userPromptConfig,
  });

  const result = await generate({
    model: modelOptions.model,
    schema: runtimeResponseSchema,
    system: [
      systemPrompt,
      "Runtime response writer instructions:",
      "- Return JSON only.",
      "- Write exactly one assistant reply for the user.",
      "- Use natural butler voice. Avoid robotic phrases like 'The latest item I found is'.",
      "- Keep it concise and direct.",
      "- If mode is clarification, ask one concrete follow-up question.",
      "- If mode is approval_pending, clearly say approval is needed and what happens next.",
      "- Never claim success unless evidence confirms it.",
    ].join("\n"),
    prompt: [
      `Mode: ${mode}`,
      `User request: ${request}`,
      `Approvals count: ${approvalsCount}`,
      "Executed tool evidence JSON:",
      formatEvidence(results),
      `Fallback guidance (use only if evidence is weak): ${fallbackText}`,
      'Return: {"responseText":"..."}',
    ].join("\n\n"),
  });

  return result.object.responseText.trim();
}
