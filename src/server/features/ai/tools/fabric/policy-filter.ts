import type { RuntimeToolDefinition } from "@/server/features/ai/tools/fabric/types";

export interface ToolFilterParams {
  includeDangerous?: boolean;
  message?: string;
  strictReadOnly?: boolean;
}

type DomainHint = "inbox" | "calendar" | "rule";

function inferDomainHints(message: string): DomainHint[] {
  const normalized = message.toLowerCase();
  const hints: DomainHint[] = [];
  if (/\b(inbox|email|thread|message|draft|reply)\b/u.test(normalized)) {
    hints.push("inbox");
  }
  if (/\b(calendar|meeting|event|schedule|reschedule|availability)\b/u.test(normalized)) {
    hints.push("calendar");
  }
  if (/\b(rule|approval|policy|permission|automation|preference)\b/u.test(normalized)) {
    hints.push("rule");
  }
  return hints;
}

function inferMutationIntent(message: string): boolean {
  const normalized = message.toLowerCase();
  return /\b(create|update|edit|change|delete|remove|archive|trash|send|reply|move|label|reschedule|book|cancel|block|unsubscribe)\b/u.test(
    normalized,
  );
}

function scoreToolRelevance(
  tool: RuntimeToolDefinition,
  params: ToolFilterParams,
): number {
  const message = params.message?.trim() ?? "";
  if (!message) {
    return 0;
  }

  let score = 0;
  const hints = inferDomainHints(message);
  const mutationIntent = inferMutationIntent(message);
  const families = tool.metadata.intentFamilies;

  if (hints.includes("inbox") && families.some((family) => family.startsWith("inbox_"))) {
    score += 6;
  }
  if (hints.includes("calendar") && families.some((family) => family.startsWith("calendar_"))) {
    score += 6;
  }
  if (
    hints.includes("rule") &&
    (families.includes("calendar_policy") || families.includes("cross_surface_planning"))
  ) {
    score += 4;
  }

  if (!mutationIntent && tool.metadata.readOnly) {
    score += 3;
  }
  if (mutationIntent && !tool.metadata.readOnly) {
    score += 3;
  }
  if (!mutationIntent && tool.metadata.riskLevel === "dangerous") {
    score -= 3;
  }

  return score;
}

export function filterToolRegistry(
  registry: RuntimeToolDefinition[],
  params: ToolFilterParams,
): RuntimeToolDefinition[] {
  const filtered = registry.filter((tool) => {
    if (params.strictReadOnly && !tool.metadata.readOnly) {
      return false;
    }
    if (params.includeDangerous) {
      return true;
    }
    return tool.metadata.riskLevel !== "dangerous";
  });

  return filtered
    .map((tool, index) => ({
      tool,
      index,
      score: scoreToolRelevance(tool, params),
    }))
    .sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score;
      return a.index - b.index;
    })
    .map((item) => item.tool);
}
