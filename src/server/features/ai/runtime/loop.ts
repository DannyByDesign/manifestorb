import { createGenerateText } from "@/server/lib/llms";
import { getModel } from "@/server/lib/llms/model";
import type { RuntimeSession } from "@/server/features/ai/runtime/types";
import { runRuntimeAttempt } from "@/server/features/ai/runtime/attempt";
import { buildRuntimeExecutionPlan } from "@/server/features/ai/runtime/planner";
import type { ToolResult } from "@/server/features/ai/tools/types";

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
  return "details unavailable";
}

function directResponseFromSingleResult(message: string, result: ToolResult): string {
  if (!result.success) {
    return (
      result.message ||
      "I couldn’t complete that request with a direct execution pass."
    );
  }

  const list = extractListFromResultData(result.data);
  const normalized = message.toLowerCase();
  const wantsFirst = /\b(first|1st|top)\b/u.test(normalized);
  const wantsLast = /\b(last|latest|most recent)\b/u.test(normalized);

  if (list.length > 0 && (wantsFirst || wantsLast)) {
    const selected = wantsLast ? list[list.length - 1] : list[0];
    const ordinal = wantsLast ? "latest" : "first";
    return `The ${ordinal} item I found is ${summarizeListItem(selected)}.`;
  }

  if (result.message) {
    return result.message;
  }
  if (list.length > 0) {
    return `Found ${list.length} item${list.length === 1 ? "" : "s"}.`;
  }

  return "Completed the request.";
}

function canRunDirectSingleRead(session: RuntimeSession): boolean {
  const plan = session.plan;
  if (!plan) return false;
  if (plan.intent !== "read") return false;
  if (plan.confidence < 0.92) return false;
  if (plan.steps.length !== 1) return false;
  const step = plan.steps[0];
  const capability = session.toolRegistry.find(
    (definition) => definition.capabilityId === step.capabilityId,
  );
  return Boolean(capability?.metadata.readOnly);
}

async function runDirectSingleRead(session: RuntimeSession): Promise<{ text: string } | null> {
  if (!canRunDirectSingleRead(session) || !session.plan) return null;
  const step = session.plan.steps[0];
  const definition = session.toolRegistry.find(
    (item) => item.capabilityId === step.capabilityId,
  );
  if (!definition) return null;
  const tool = session.tools[definition.toolName];
  if (!tool?.execute) return null;

  session.input.logger.info("openworld.runtime.direct_read", {
    userId: session.input.userId,
    provider: session.input.provider,
    capabilityId: step.capabilityId,
    confidence: session.plan.confidence,
  });

  const rawResult = await (
    tool.execute as (args: unknown, options: unknown) => Promise<unknown>
  )(step.args, {});
  const result = rawResult as ToolResult;
  return {
    text: directResponseFromSingleResult(session.input.message, result),
  };
}

export async function runRuntimeLoop(session: RuntimeSession): Promise<{ text: string }> {
  try {
    session.plan = await buildRuntimeExecutionPlan(session);
    session.input.logger.info("openworld.runtime.plan", {
      userId: session.input.userId,
      provider: session.input.provider,
      source: session.plan.source,
      intent: session.plan.intent,
      confidence: session.plan.confidence,
      stepCount: session.plan.steps.length,
      issueCount: session.plan.issues.length,
    });

    const direct = await runDirectSingleRead(session);
    if (direct) {
      return direct;
    }

    return await runRuntimeAttempt(session);
  } catch (error) {
    session.input.logger.error("Open-world runtime attempt failed", { error });

    const fallbackGenerate = createGenerateText({
      emailAccount: {
        id: session.input.emailAccountId,
        email: session.input.email,
        userId: session.input.userId,
      },
      label: "openworld-runtime-fallback-chat",
      modelOptions: getModel("chat"),
    });

    const fallback = await fallbackGenerate({
      model: getModel("chat").model,
      system:
        "You are Amodel. The tool runtime failed. Briefly explain the failure and ask the user to retry with a concise request.",
      prompt: session.input.message,
    });

    return {
      text:
        fallback.text?.trim() ||
        "I hit a runtime issue while executing that. Please retry the request in one sentence.",
    };
  }
}
