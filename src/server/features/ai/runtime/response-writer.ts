import { z } from "zod";
import { createGenerateObject } from "@/server/lib/llms";
import { getModel } from "@/server/lib/llms/model";
import { buildAgentSystemPrompt, type Platform } from "@/server/features/ai/system-prompt";
import type { RuntimeSession } from "@/server/features/ai/runtime/types";
import type { RuntimeToolResult } from "@/server/features/ai/tools/contracts/tool-result";
import { resolveDefaultCalendarTimeZone } from "@/server/features/ai/tools/calendar-time";
import { env } from "@/env";
import { renderRuntimeContextForPrompt } from "@/server/features/ai/runtime/context/render";

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

function latestClarificationResult(results: RuntimeToolResult[]): RuntimeToolResult | null {
  for (let i = results.length - 1; i >= 0; i -= 1) {
    const result = results[i];
    if (result?.clarification) return result;
  }
  return null;
}

function buildDeterministicClarificationReply(result: RuntimeToolResult | null): string | null {
  if (!result?.clarification) return null;
  const prompt = String(result.clarification.prompt ?? "").trim();
  const missing = Array.isArray(result.clarification.missingFields)
    ? result.clarification.missingFields.filter((v) => typeof v === "string" && v.trim().length > 0)
    : [];
  const dataObj = result.data && typeof result.data === "object" ? (result.data as Record<string, unknown>) : {};

  if (prompt === "calendar_reschedule_target_ambiguous" || prompt === "policy_rule_target_ambiguous") {
    const candidates = Array.isArray((dataObj as any).candidates) ? ((dataObj as any).candidates as any[]) : [];
    if (candidates.length > 0) {
      const lines = candidates.slice(0, 5).map((candidate, idx) => {
        const obj = candidate && typeof candidate === "object" ? (candidate as Record<string, unknown>) : {};
        const label =
          typeof obj.title === "string"
            ? obj.title
            : typeof obj.name === "string"
              ? obj.name
              : typeof obj.id === "string"
                ? obj.id
                : "option";
        const when =
          typeof obj.startLocal === "string"
            ? obj.startLocal
            : typeof obj.start === "string"
              ? obj.start
              : null;
        return `${idx + 1}. ${label}${when ? ` (${when})` : ""}`;
      });
      return `Which one did you mean?\n${lines.join("\n")}\nReply with the number.`;
    }
  }

  if (prompt === "email_draft_id_required") {
    return "Which draft should I use? Reply with the draft id (or tell me to use your most recent draft).";
  }
  if (prompt === "email_reply_parent_required" || prompt === "email_forward_parent_required") {
    return "Which email/thread should I use? Reply with the thread id or message id.";
  }
  if (prompt === "email_bulk_target_required") {
    return "Which emails should I target? Paste the thread/message ids, or describe a search filter (for example: \"unread from Stripe last 7 days\").";
  }
  if (prompt === "calendar_event_id_required") {
    return "Which calendar event should I use? Reply with the event id.";
  }
  if (prompt === "calendar_selection_required") {
    return "Which calendars should I use? Tell me the calendar names (or say \"primary only\").";
  }
  if (prompt === "search_target_unclear") {
    return "What should I search for (keywords/person), and what time range should I use?";
  }

  if (missing.length > 0) {
    return `What should I use for ${missing.join(", ")}?`;
  }

  return "What detail should I use to proceed?";
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
  if (mode === "clarification") {
    const deterministic = buildDeterministicClarificationReply(latestClarificationResult(results));
    if (deterministic) return deterministic;
  }
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
      "- Match the core assistant voice: capable human assistant and teammate.",
      "- Write like a real human: direct, clear, and modern.",
      "- Use light humor or banter when appropriate, but keep it subtle and brief.",
      "- Do not force jokes in sensitive, error, approval, or clarification moments.",
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
