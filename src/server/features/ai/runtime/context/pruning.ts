import type { ModelMessage } from "ai";

export interface RuntimeMessagePruningConfig {
  softLimitChars: number;
  hardLimitChars: number;
  protectedAssistantTail: number;
  minAssistantChars: number;
}

export interface RuntimeMessagePruneResult {
  messages: ModelMessage[];
  mode: "none" | "soft" | "hard";
  beforeChars: number;
  afterChars: number;
  removedCount: number;
  truncatedCount: number;
  pruned: boolean;
}

const DEFAULT_CONFIG: RuntimeMessagePruningConfig = {
  softLimitChars: 32_000,
  hardLimitChars: 20_000,
  protectedAssistantTail: 2,
  minAssistantChars: 96,
};

function parseConfigNumber(name: string, fallback: number, min: number, max: number): number {
  const raw = process.env[name];
  if (typeof raw !== "string" || raw.trim().length === 0) return fallback;
  const parsed = Number.parseInt(raw, 10);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(Math.max(parsed, min), max);
}

export function resolveRuntimeMessagePruningConfig(): RuntimeMessagePruningConfig {
  return {
    softLimitChars: parseConfigNumber("RUNTIME_PRUNE_SOFT_LIMIT_CHARS", DEFAULT_CONFIG.softLimitChars, 8_000, 200_000),
    hardLimitChars: parseConfigNumber("RUNTIME_PRUNE_HARD_LIMIT_CHARS", DEFAULT_CONFIG.hardLimitChars, 4_000, 120_000),
    protectedAssistantTail: parseConfigNumber(
      "RUNTIME_PRUNE_ASSISTANT_TAIL",
      DEFAULT_CONFIG.protectedAssistantTail,
      1,
      6,
    ),
    minAssistantChars: parseConfigNumber(
      "RUNTIME_PRUNE_MIN_ASSISTANT_CHARS",
      DEFAULT_CONFIG.minAssistantChars,
      40,
      500,
    ),
  };
}

function textFromContent(content: ModelMessage["content"]): string {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content
    .map((part) => {
      if (!part || typeof part !== "object" || !("type" in part)) return "";
      if (part.type !== "text") return "";
      return "text" in part && typeof part.text === "string" ? part.text : "";
    })
    .join(" ")
    .trim();
}

function cloneWithTextContent(message: ModelMessage, text: string): ModelMessage {
  if (message.role === "tool") {
    return message;
  }

  if (typeof message.content === "string") {
    return {
      ...message,
      content: text,
    } as ModelMessage;
  }

  if (!Array.isArray(message.content)) {
    return message;
  }

  const nextContent: Array<Record<string, unknown>> = [];
  let remaining = text;
  for (const part of message.content) {
    if (!part || typeof part !== "object" || !("type" in part)) {
      nextContent.push(part as unknown as Record<string, unknown>);
      continue;
    }
    if (part.type !== "text") {
      nextContent.push(part as unknown as Record<string, unknown>);
      continue;
    }

    const current = "text" in part && typeof part.text === "string" ? part.text : "";
    const slice = remaining.slice(0, current.length);
    nextContent.push({ ...(part as unknown as Record<string, unknown>), text: slice });
    remaining = remaining.slice(slice.length);
  }

  return {
    ...message,
    content: nextContent as unknown as ModelMessage["content"],
  } as ModelMessage;
}

export function estimateRuntimeMessageChars(message: ModelMessage): number {
  return textFromContent(message.content).length;
}

export function estimateRuntimeMessagesChars(messages: ModelMessage[]): number {
  return messages.reduce((sum, message) => sum + estimateRuntimeMessageChars(message), 0);
}

function assistantTailIndexes(messages: ModelMessage[], tailSize: number): Set<number> {
  const indexes = new Set<number>();
  let remaining = tailSize;

  for (let index = messages.length - 1; index >= 0; index -= 1) {
    if (remaining <= 0) break;
    const role = messages[index]?.role;
    if (role === "assistant" || role === "tool" || role === "system") {
      indexes.add(index);
      remaining -= 1;
    }
  }

  return indexes;
}

export function pruneRuntimeMessages(params: {
  messages: ModelMessage[];
  mode: "soft" | "hard";
  config?: RuntimeMessagePruningConfig;
}): RuntimeMessagePruneResult {
  const config = params.config ?? resolveRuntimeMessagePruningConfig();
  const limit = params.mode === "soft" ? config.softLimitChars : config.hardLimitChars;
  const beforeChars = estimateRuntimeMessagesChars(params.messages);

  if (beforeChars <= limit) {
    return {
      messages: params.messages,
      mode: "none",
      beforeChars,
      afterChars: beforeChars,
      removedCount: 0,
      truncatedCount: 0,
      pruned: false,
    };
  }

  const protectedAssistant = assistantTailIndexes(params.messages, config.protectedAssistantTail);
  const protectedIndexes = new Set<number>();
  for (let i = 0; i < params.messages.length; i += 1) {
    const role = params.messages[i]?.role;
    if (role === "user" || protectedAssistant.has(i)) {
      protectedIndexes.add(i);
    }
  }

  const selected: Array<{ index: number; message: ModelMessage }> = [];
  let selectedChars = 0;
  for (let index = params.messages.length - 1; index >= 0; index -= 1) {
    const message = params.messages[index];
    if (!message) continue;

    const chars = estimateRuntimeMessageChars(message);
    if (protectedIndexes.has(index)) {
      selected.push({ index, message });
      selectedChars += chars;
      continue;
    }

    if (selectedChars + chars <= limit) {
      selected.push({ index, message });
      selectedChars += chars;
    }
  }

  selected.sort((a, b) => a.index - b.index);
  const selectedMessages = selected.map((entry) => entry.message);

  let afterChars = estimateRuntimeMessagesChars(selectedMessages);
  let truncatedCount = 0;
  if (afterChars > limit) {
    const mutable = [...selectedMessages];

    for (let i = 0; i < mutable.length; i += 1) {
      const message = mutable[i];
      if (!message || message.role === "user") continue;
      if (afterChars <= limit) break;

      const text = textFromContent(message.content);
      if (!text) continue;

      const overflow = afterChars - limit;
      const nextLength = Math.max(config.minAssistantChars, text.length - overflow);
      if (nextLength >= text.length) continue;

      const truncatedText = `${text.slice(0, Math.max(0, nextLength - 13))} [truncated]`;
      mutable[i] = cloneWithTextContent(message, truncatedText);
      truncatedCount += 1;
      afterChars = estimateRuntimeMessagesChars(mutable);
    }

    return {
      messages: mutable,
      mode: params.mode,
      beforeChars,
      afterChars,
      removedCount: Math.max(0, params.messages.length - mutable.length),
      truncatedCount,
      pruned: true,
    };
  }

  return {
    messages: selectedMessages,
    mode: params.mode,
    beforeChars,
    afterChars,
    removedCount: Math.max(0, params.messages.length - selectedMessages.length),
    truncatedCount,
    pruned: true,
  };
}
