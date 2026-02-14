import { createGenerateObject } from "@/server/lib/llms";
import { getModel } from "@/server/lib/llms/model";
import type { RuntimeSession } from "@/server/features/ai/runtime/types";
import {
  runtimeDecisionSchema,
  type RuntimeDecision,
} from "@/server/features/ai/runtime/decision/schema";
import type { RuntimeToolResult } from "@/server/features/ai/tools/contracts/tool-result";
import { buildAgentSystemPrompt, type Platform } from "@/server/features/ai/system-prompt";
import { env } from "@/env";

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

function formatToolCatalog(session: RuntimeSession): string {
  return session.toolRegistry
    .map((tool) => {
      const mode = tool.metadata.readOnly ? "read_only" : "mutating";
      const families = tool.metadata.intentFamilies.join(",") || "general";
      const name = "name" in tool && typeof tool.name === "string" ? tool.name : tool.toolName;
      return `- ${name} | ${mode} | risk=${tool.metadata.riskLevel} | families=${families} | ${tool.description}`;
    })
    .join("\n");
}

function formatEvidence(results: RuntimeToolResult[]): string {
  if (results.length === 0) return "[]";
  const payload = results.slice(-4).map((result) => ({
    success: result.success,
    message: result.message ?? null,
    error: result.error ?? null,
    data: compact(result.data),
  }));
  return JSON.stringify(payload);
}

function toPlatform(provider: string): Platform {
  if (provider === "slack" || provider === "discord" || provider === "telegram") {
    return provider;
  }
  return "web";
}

function buildDecisionSystemPrompt(session: RuntimeSession): string {
  const globalPrompt = buildAgentSystemPrompt({
    platform: toPlatform(session.input.provider),
    emailSendEnabled: env.NEXT_PUBLIC_EMAIL_SEND_ENABLED,
    userConfig: session.userPromptConfig,
  });

  return [
    globalPrompt,
    "Runtime controller instructions:",
    "- Return JSON only.",
    "- If the user is greeting, bantering, or asking for capabilities, respond directly without tools.",
    "- Use tool_call only when external data or side effects are required.",
    "- Use respond only when you can answer from conversation context or collected tool evidence.",
    "- Use clarify only when a required field is missing and cannot be inferred.",
    "- For tool_call, provide toolName and argsJson (JSON object string).",
    "- Do not call tools for small talk.",
  ].join("\n");
}

export async function generateRuntimeDecision(params: {
  session: RuntimeSession;
  executedResults: RuntimeToolResult[];
  attempt: number;
}): Promise<RuntimeDecision> {
  const { session, executedResults, attempt } = params;
  const generate = createGenerateObject({
    emailAccount: {
      id: session.input.emailAccountId,
      email: session.input.email,
      userId: session.input.userId,
    },
    label: "openworld-runtime-decision-generate",
    modelOptions: getModel("economy"),
  });

  const result = await generate({
    model: getModel("economy").model,
    schema: runtimeDecisionSchema,
    system: buildDecisionSystemPrompt(session),
    prompt: [
      `Attempt: ${attempt}`,
      `User request: ${session.input.message}`,
      ...(session.skillSnapshot.promptSection
        ? ["Active skill guidance:", session.skillSnapshot.promptSection]
        : []),
      "Available tools:",
      formatToolCatalog(session),
      "Executed tool evidence JSON:",
      formatEvidence(executedResults),
      'Return: {"type":"tool_call|respond|clarify","toolName?":"...","argsJson?":"{...}","responseText?":"...","rationale?":"..."}',
    ].join("\n\n"),
  });

  return result.object;
}
