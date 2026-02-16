import type { ContextPack } from "@/server/features/memory/context-manager";

export interface RuntimeContextRenderOptions {
  maxChars?: number;
  maxFacts?: number;
  maxKnowledge?: number;
  maxHistory?: number;
}

export interface RuntimeContextRenderResult {
  promptBlock: string;
  truncated: boolean;
}

const DEFAULT_OPTIONS: Required<RuntimeContextRenderOptions> = {
  maxChars: 2_800,
  maxFacts: 8,
  maxKnowledge: 4,
  maxHistory: 6,
};

function cleanText(value: string, maxChars: number): string {
  const trimmed = value.replace(/\s+/g, " ").trim();
  if (trimmed.length <= maxChars) return trimmed;
  return `${trimmed.slice(0, Math.max(0, maxChars - 13))} [truncated]`;
}

function appendSection(lines: string[], title: string, entries: string[]): void {
  if (entries.length === 0) return;
  lines.push(title);
  for (const entry of entries) {
    lines.push(`- ${entry}`);
  }
}

export function renderRuntimeContextForPrompt(
  contextPack: ContextPack | undefined,
  options?: RuntimeContextRenderOptions,
): RuntimeContextRenderResult {
  if (!contextPack) {
    return {
      promptBlock: "",
      truncated: false,
    };
  }

  const resolved = {
    ...DEFAULT_OPTIONS,
    ...options,
  };

  const lines: string[] = [];

  if (contextPack.system.summary) {
    lines.push(`User summary: ${cleanText(contextPack.system.summary, 550)}`);
  }

  appendSection(
    lines,
    "Known facts:",
    contextPack.facts
      .slice(0, resolved.maxFacts)
      .map((fact) => `${fact.key}: ${cleanText(fact.value, 140)}`),
  );

  appendSection(
    lines,
    "Knowledge snippets:",
    contextPack.knowledge
      .slice(0, resolved.maxKnowledge)
      .map((entry) => `${entry.title}: ${cleanText(entry.content, 160)}`),
  );

  appendSection(
    lines,
    "Recent conversation context:",
    contextPack.history
      .slice(-resolved.maxHistory)
      .map((message) => `[${message.role}] ${cleanText(message.content, 180)}`),
  );

  if (contextPack.pendingState?.scheduleProposal) {
    const schedule = contextPack.pendingState.scheduleProposal;
    lines.push(
      `Pending schedule proposal: ${cleanText(schedule.description, 180)} (${schedule.options.length} option(s))`,
    );
  }

  if (Array.isArray(contextPack.pendingState?.approvals) && contextPack.pendingState.approvals.length > 0) {
    lines.push(`Pending approvals: ${contextPack.pendingState.approvals.length}`);
  }

  const attentionCount = contextPack.attentionItems?.length ?? 0;
  if (attentionCount > 0) {
    lines.push(`Attention items: ${attentionCount}`);
  }

  let promptBlock = lines.join("\n").trim();
  let truncated = false;
  if (promptBlock.length > resolved.maxChars) {
    promptBlock = `${promptBlock.slice(0, Math.max(0, resolved.maxChars - 13))} [truncated]`;
    truncated = true;
  }

  return { promptBlock, truncated };
}
