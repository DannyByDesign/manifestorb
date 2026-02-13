import { stepCountIs, type ModelMessage } from "ai";
import { createGenerateText } from "@/server/lib/llms";
import { getModel } from "@/server/lib/llms/model";
import type { RuntimeSession } from "@/server/features/ai/runtime/types";
import { emitUnsupportedIntent } from "@/server/features/ai/runtime/telemetry/unsupported-intents";

function buildSystemPrompt(session: RuntimeSession): string {
  const skillSection = session.skillSnapshot.promptSection
    ? `\n\nCapability Hints:\n${session.skillSnapshot.promptSection}`
    : "";

  return [
    "You are Amodel, an open-world AI operations agent for inbox and calendar.",
    "Interpret messy natural language and execute requests using tools whenever data retrieval or actions are needed.",
    "Do not claim you completed actions unless tool results confirm it.",
    "For read requests, call tools and answer directly with concrete results.",
    "For mutation requests, execute tools and clearly report what changed.",
    "If blocked by policy or approval requirements, explain exactly what is blocked and why.",
    "If information is missing, ask one concise clarification question.",
    skillSection,
  ]
    .filter(Boolean)
    .join("\n");
}

function toUserMessages(session: RuntimeSession): ModelMessage[] {
  if (Array.isArray(session.input.messages) && session.input.messages.length > 0) {
    return session.input.messages;
  }
  return [{ role: "user", content: session.input.message }];
}

function summarizeToolOutcomes(session: RuntimeSession): string {
  const successful = session.summaries.filter((summary) => summary.result.success);
  if (successful.length === 0) {
    if (session.artifacts.approvals.length > 0) {
      return "I prepared approval requests for restricted actions. Approve them and I can proceed.";
    }
    emitUnsupportedIntent({
      logger: session.input.logger,
      userId: session.input.userId,
      provider: session.input.provider,
      message: session.input.message,
      reason: "no_successful_tools",
    });
    return "I couldn't complete that with the available tools. Please clarify what output you want first.";
  }

  const lines = successful.slice(0, 4).map((summary) => {
    const message = summary.result.message ?? "completed";
    return `- ${summary.capabilityId}: ${message}`;
  });
  return `Executed ${successful.length} capability step${successful.length === 1 ? "" : "s"}:\n${lines.join("\n")}`;
}

function compactValue(value: unknown, depth = 0): unknown {
  if (depth > 2) {
    return typeof value === "object" ? "[truncated]" : value;
  }
  if (Array.isArray(value)) {
    const limited = value.slice(0, 5).map((entry) => compactValue(entry, depth + 1));
    if (value.length > 5) {
      limited.push({ truncated: true, omitted: value.length - 5 });
    }
    return limited;
  }
  if (!value || typeof value !== "object") {
    return value;
  }
  const entries = Object.entries(value as Record<string, unknown>).slice(0, 10);
  const out: Record<string, unknown> = {};
  for (const [key, entry] of entries) {
    out[key] = compactValue(entry, depth + 1);
  }
  return out;
}

function buildToolEvidence(session: RuntimeSession): string {
  const successful = session.summaries.filter((summary) => summary.result.success);
  const payload = successful.slice(0, 4).map((summary) => ({
    capabilityId: summary.capabilityId,
    message: summary.result.message ?? null,
    data: compactValue(summary.result.data),
  }));
  return JSON.stringify(payload);
}

function extractListFromResultData(data: unknown): unknown[] {
  if (Array.isArray(data)) return data;
  if (!data || typeof data !== "object") return [];
  const record = data as Record<string, unknown>;
  if (Array.isArray(record.items)) return record.items;
  if (Array.isArray(record.messages)) return record.messages;
  if (Array.isArray(record.events)) return record.events;
  return [];
}

function summarizeListItem(item: unknown): string {
  if (!item || typeof item !== "object") {
    return String(item);
  }
  const record = item as Record<string, unknown>;
  const headers =
    record.headers && typeof record.headers === "object" && !Array.isArray(record.headers)
      ? (record.headers as Record<string, unknown>)
      : {};
  const subject =
    typeof record.subject === "string"
      ? record.subject
      : typeof record.title === "string"
        ? record.title
      : typeof headers.subject === "string"
        ? headers.subject
        : undefined;
  const from =
    typeof record.from === "string"
      ? record.from
      : typeof headers.from === "string"
        ? headers.from
        : undefined;
  const when =
    typeof record.date === "string"
      ? record.date
      : typeof headers.date === "string"
        ? headers.date
        : typeof record.start === "string"
          ? record.start
          : undefined;

  const parts = [
    subject ? `subject "${subject}"` : null,
    from ? `from ${from}` : null,
    when ? `at ${when}` : null,
  ].filter((part): part is string => Boolean(part));

  if (parts.length > 0) {
    return parts.join(", ");
  }

  try {
    return JSON.stringify(compactValue(item));
  } catch {
    return "details unavailable";
  }
}

function deriveDeterministicListAnswer(session: RuntimeSession): string | null {
  const request = session.input.message.toLowerCase();
  const wantsFirst = /\b(first|1st|top)\b/u.test(request);
  const wantsLast = /\b(last|latest|most recent)\b/u.test(request);
  if (!wantsFirst && !wantsLast) return null;

  const successful = session.summaries.filter((summary) => summary.result.success);
  for (const summary of successful) {
    const items = extractListFromResultData(summary.result.data);
    if (items.length === 0) continue;
    const selected = wantsLast ? items[items.length - 1] : items[0];
    const ordinal = wantsLast ? "latest" : "first";
    const details = summarizeListItem(selected);
    return `The ${ordinal} item I found is ${details}.`;
  }
  return null;
}

function looksLikeExecutionStatusText(text: string): boolean {
  const normalized = text.toLowerCase().trim();
  if (!normalized) return false;
  const executionMarkers = [
    "[done]",
    "matching email",
    "matching emails",
    "matching messages",
    "executed",
    "capability step",
  ];
  const hasMarker = executionMarkers.some((marker) => normalized.includes(marker));
  const lineCount = normalized.split("\n").length;
  const hasConversationCues =
    normalized.includes("first item") ||
    normalized.includes("subject") ||
    normalized.includes("from ");
  return hasMarker && lineCount <= 6 && !hasConversationCues;
}

async function synthesizeFinalAnswer(session: RuntimeSession): Promise<string | null> {
  const successful = session.summaries.filter((summary) => summary.result.success);
  if (successful.length === 0) return null;

  const finalizeGenerate = createGenerateText({
    emailAccount: {
      id: session.input.emailAccountId,
      email: session.input.email,
      userId: session.input.userId,
    },
    label: "openworld-runtime-finalize-answer",
    modelOptions: getModel("economy"),
  });

  const evidence = buildToolEvidence(session);
  const response = await finalizeGenerate({
    model: getModel("economy").model,
    system: [
      "You are Amodel.",
      "Convert executed tool evidence into a direct answer to the user.",
      "Use only the provided evidence. Do not invent details.",
      "If evidence is partial or missing, clearly say what is missing in one sentence.",
      "Keep answers concise and concrete.",
    ].join("\n"),
    prompt: [
      `User request: ${session.input.message}`,
      `Tool evidence JSON: ${evidence}`,
      "Answer:",
    ].join("\n\n"),
  });

  const text = response.text?.trim();
  return text && text.length > 0 ? text : null;
}

export async function runRuntimeAttempt(session: RuntimeSession): Promise<{ text: string }> {
  const generate = createGenerateText({
    emailAccount: {
      id: session.input.emailAccountId,
      email: session.input.email,
      userId: session.input.userId,
    },
    label: "openworld-runtime-turn",
    modelOptions: getModel("default"),
  });

  const result = await generate({
    model: getModel("default").model,
    system: buildSystemPrompt(session),
    messages: toUserMessages(session),
    tools: session.tools,
    stopWhen: stepCountIs(16),
  });

  const text = result.text?.trim();
  if (text && text.length > 0 && !looksLikeExecutionStatusText(text)) {
    return { text };
  }

  const deterministic = deriveDeterministicListAnswer(session);
  if (deterministic) {
    return { text: deterministic };
  }

  if (text && text.length > 0) {
    try {
      const synthesizedFromStatusText = await synthesizeFinalAnswer(session);
      if (synthesizedFromStatusText) {
        return { text: synthesizedFromStatusText };
      }
    } catch (error) {
      session.input.logger.warn("Runtime execution-status rewrite failed", { error });
    }
  }

  try {
    const synthesized = await synthesizeFinalAnswer(session);
    if (synthesized) {
      return { text: synthesized };
    }
  } catch (error) {
    session.input.logger.warn("Runtime response synthesis failed", { error });
  }

  return { text: summarizeToolOutcomes(session) };
}
