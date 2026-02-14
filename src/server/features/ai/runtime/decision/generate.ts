import { createGenerateObject } from "@/server/lib/llms";
import { getModel } from "@/server/lib/llms/model";
import type { RuntimeSession } from "@/server/features/ai/runtime/types";
import {
  runtimeDecisionSchema,
  type RuntimeDecision,
} from "@/server/features/ai/runtime/decision/schema";
import type { RuntimeToolResult } from "@/server/features/ai/tools/contracts/tool-result";

const MAX_TOOL_CATALOG_ITEMS_FIRST_ATTEMPT = 14;
const MAX_TOOL_CATALOG_ITEMS_FOLLOWUP = 24;
const MAX_SKILL_SECTION_CHARS = 2200;
const MAX_CUSTOM_INSTRUCTIONS_CHARS = 500;

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

function formatToolCatalog(
  session: RuntimeSession,
  attempt: number,
  routeToolCatalogLimit?: number,
): string {
  const baseLimit =
    attempt <= 1
      ? MAX_TOOL_CATALOG_ITEMS_FIRST_ATTEMPT
      : MAX_TOOL_CATALOG_ITEMS_FOLLOWUP;
  const maxItems = routeToolCatalogLimit
    ? Math.max(1, Math.min(baseLimit, routeToolCatalogLimit))
    : baseLimit;
  const selected = session.toolRegistry.slice(0, maxItems);
  const lines = selected
    .map((tool) => {
      const mode = tool.metadata.readOnly ? "read_only" : "mutating";
      const families = tool.metadata.intentFamilies.join(",") || "general";
      const name = "name" in tool && typeof tool.name === "string" ? tool.name : tool.toolName;
      return `- ${name} | ${mode} | risk=${tool.metadata.riskLevel} | families=${families} | ${tool.description}`;
    });

  const omitted = Math.max(session.toolRegistry.length - selected.length, 0);
  if (omitted > 0) lines.push(`- ... ${omitted} more tools omitted for brevity`);

  return lines.join("\n");
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

function buildDecisionSystemPrompt(session: RuntimeSession): string {
  const custom = session.userPromptConfig?.customInstructions?.trim();
  const compactCustom =
    custom && custom.length > 0
      ? custom.slice(0, MAX_CUSTOM_INSTRUCTIONS_CHARS)
      : "";

  return [
    "You are the runtime decision controller for an inbox/calendar assistant.",
    "- Return JSON only.",
    "- Be decisive. Prefer one clear action.",
    "- If the user is greeting, bantering, or asking for capabilities, respond directly without tools.",
    "- Use tool_call only when external data or side effects are required.",
    "- Use respond only when you can answer from conversation context or collected tool evidence.",
    "- Use clarify only when a required field is missing and cannot be inferred.",
    "- If request is read-only and likely needs fresh data, choose one read-only tool call.",
    "- Avoid chaining many steps for simple requests.",
    "- For tool_call, provide toolName and argsJson (JSON object string).",
    "- Do not call tools for small talk.",
    ...(compactCustom
      ? [
          "User-specific constraints (truncated):",
          compactCustom,
        ]
      : []),
  ].join("\n");
}

export async function generateRuntimeDecision(params: {
  session: RuntimeSession;
  executedResults: RuntimeToolResult[];
  attempt: number;
  route?: {
    toolCatalogLimit?: number;
    includeSkillGuidance?: boolean;
  };
}): Promise<RuntimeDecision> {
  const { session, executedResults, attempt, route } = params;
  const modelOptions = getModel("economy");
  const toolCatalog = formatToolCatalog(session, attempt, route?.toolCatalogLimit);
  const includeSkillGuidance = route?.includeSkillGuidance ?? true;
  const skillSection =
    includeSkillGuidance && session.skillSnapshot.promptSection
      ? session.skillSnapshot.promptSection.slice(0, MAX_SKILL_SECTION_CHARS)
      : "";
  const generate = createGenerateObject({
    emailAccount: {
      id: session.input.emailAccountId,
      email: session.input.email,
      userId: session.input.userId,
    },
    label: "openworld-runtime-decision-generate",
    modelOptions,
    maxLLMRetries: 0,
  });

  const prompt = [
    `Attempt: ${attempt}`,
    `User request: ${session.input.message}`,
    ...(skillSection
      ? ["Active skill guidance:", skillSection]
      : []),
    "Available tools:",
    toolCatalog,
    "Executed tool evidence JSON:",
    formatEvidence(executedResults),
    'Return: {"type":"tool_call|respond|clarify","toolName?":"...","argsJson?":"{...}","responseText?":"...","rationale?":"..."}',
  ].join("\n\n");
  const startedAt = Date.now();
  session.input.logger.info("Runtime decision generation start", {
    attempt,
    toolCount: session.toolRegistry.length,
    includeSkillGuidance,
    toolCatalogChars: toolCatalog.length,
    skillSectionChars: skillSection.length,
    promptChars: prompt.length,
  });

  const result = await generate({
    model: modelOptions.model,
    schema: runtimeDecisionSchema,
    system: buildDecisionSystemPrompt(session),
    prompt,
  });

  session.input.logger.info("Runtime decision generation complete", {
    attempt,
    durationMs: Date.now() - startedAt,
    decisionType: result.object.type,
    toolName: result.object.toolName ?? null,
  });

  return result.object;
}
