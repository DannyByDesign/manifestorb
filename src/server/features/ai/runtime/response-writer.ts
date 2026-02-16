import { z } from "zod";
import { generateObject } from "ai";
import { createGenerateObject } from "@/server/lib/llms";
import { getModel } from "@/server/lib/llms/model";
import { buildAgentSystemPrompt, type Platform } from "@/server/features/ai/system-prompt";
import type { RuntimeSession } from "@/server/features/ai/runtime/types";
import type { RuntimeToolResult } from "@/server/features/ai/tools/contracts/tool-result";
import { resolveDefaultCalendarTimeZone } from "@/server/features/ai/tools/calendar-time";
import { env } from "@/env";
import { renderRuntimeContextForPrompt } from "@/server/features/ai/runtime/context/render";
import type { Logger } from "@/server/lib/logger";

const runtimeResponseSchema = z
  .object({
    responseText: z.string().min(1).max(4000),
  })
  .strict();
const RESPONSE_EVIDENCE_ARRAY_LIMIT = 10;

function compact(value: unknown, depth = 0): unknown {
  if (depth > 2) return typeof value === "object" ? "[truncated]" : value;
  if (Array.isArray(value)) {
    const out = value
      .slice(0, RESPONSE_EVIDENCE_ARRAY_LIMIT)
      .map((item) => compact(item, depth + 1));
    if (value.length > RESPONSE_EVIDENCE_ARRAY_LIMIT) {
      out.push({
        truncated: true,
        omitted: value.length - RESPONSE_EVIDENCE_ARRAY_LIMIT,
      });
    }
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

export async function renderSurfaceResponseText(params: {
  provider: string;
  request: string;
  draftText: string;
  logger: Logger;
}): Promise<string> {
  const draft = params.draftText.trim();
  if (!draft) return params.draftText;

  const modelOptions = getModel("economy");

  try {
    const result = await generateObject({
      model: modelOptions.model,
      schema: runtimeResponseSchema,
      system: [
        buildAgentSystemPrompt({
          platform: toPlatform(params.provider),
          emailSendEnabled: env.NEXT_PUBLIC_EMAIL_SEND_ENABLED,
        }),
        "Surface response writer instructions:",
        "- Rewrite the draft response to match assistant voice and tone.",
        "- Keep response concise and clear.",
        "- Preserve all concrete facts exactly (counts, names, dates, times, links, IDs).",
        "- Do not drop numbered list items when there are 10 or fewer entries.",
        "- Preserve intent and actionability; do not remove instructions or next steps.",
        "- Keep markdown links and list formatting if present.",
        "- Do not invent new facts.",
        '- Return JSON only with {"responseText":"..."}',
      ].join("\n"),
      prompt: [
        `User request: ${params.request}`,
        `Draft response to rewrite: ${draft}`,
      ].join("\n\n"),
    });

    const rewritten = result.object.responseText.trim();
    return rewritten.length > 0 ? rewritten : draft;
  } catch (error) {
    params.logger.warn("Surface response writer failed; using draft text", {
      provider: params.provider,
      error,
    });
    return draft;
  }
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
  const resolvedTimeZone = await resolveDefaultCalendarTimeZone({
    userId: session.input.userId,
    emailAccountId: session.input.emailAccountId,
  });
  const userTimeZone =
    "error" in resolvedTimeZone ? "UTC" : resolvedTimeZone.timeZone;
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
  const contextSection = renderRuntimeContextForPrompt(session.input.runtimeContextPack, {
    maxChars: 1_600,
    maxFacts: 5,
    maxKnowledge: 3,
    maxHistory: 3,
  });

  const result = await generate({
    model: modelOptions.model,
    schema: runtimeResponseSchema,
    system: [
      systemPrompt,
      "Runtime response writer instructions:",
      "- Return JSON only.",
      "- Write exactly one assistant reply for the user.",
      "- Write like a real human: direct, clear, and calm.",
      "- Use plain modern language. Avoid archaic or theatrical wording.",
      "- Avoid robotic phrases like 'The latest unread email in your inbox is...'.",
      "- Do not mention being a butler or use role-play language.",
      "- Keep it concise and direct.",
      "- Do not open with filler like 'Certainly' unless the user explicitly asks for formality.",
      "- Do not self-introduce unless the user asks who you are.",
      "- Preserve concrete facts from fallback guidance exactly (especially dates/times); do not reinterpret time zones.",
      "- If evidence includes dateLocal/startLocal/endLocal, use those fields for user-facing times.",
      "- For list/search results: include all items when there are 10 or fewer.",
      "- If there are more than 10 items, state the total and that you're showing the first 10.",
      "- Never present raw UTC offsets to the user unless they asked for UTC explicitly.",
      "- If mode is clarification, ask one concrete follow-up question.",
      "- If mode is approval_pending, clearly say approval is needed and what happens next.",
      "- Never claim success unless evidence confirms it.",
    ].join("\n"),
    prompt: [
      `Mode: ${mode}`,
      `User timezone: ${userTimeZone}`,
      `User request: ${request}`,
      session.input.runtimeContextStatus
        ? `Runtime context status: ${session.input.runtimeContextStatus}`
        : "Runtime context status: unknown",
      contextSection.promptBlock
        ? `Runtime memory context snapshot:\\n${contextSection.promptBlock}`
        : "Runtime memory context snapshot: unavailable",
      `Approvals count: ${approvalsCount}`,
      "Executed tool evidence JSON:",
      formatEvidence(results),
      `Fallback guidance (use only if evidence is weak): ${fallbackText}`,
      'Return: {"responseText":"..."}',
    ].join("\n\n"),
  });

  return result.object.responseText.trim();
}
