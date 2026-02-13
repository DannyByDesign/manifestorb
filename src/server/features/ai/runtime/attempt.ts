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
  if (text && text.length > 0) {
    return { text };
  }

  return { text: summarizeToolOutcomes(session) };
}
