import type { Logger } from "@/server/lib/logger";
import { parseSemanticRequest } from "@/server/features/ai/skills/router/parse-request";
import {
  listCapabilityDefinitions,
  type CapabilityIntentFamily,
} from "@/server/features/ai/capabilities/registry";
import type { CapabilityName } from "@/server/features/ai/skills/contracts/skill-contract";

const DEFAULT_TOP_K = 12;
const MAX_TOP_K = 20;

export interface CapabilitySelectionResult {
  candidates: CapabilityName[];
  reason: string;
  semanticConfidence: number;
  intentFamilies: string[];
}

function tokenize(input: string): string[] {
  return input
    .toLowerCase()
    .split(/[^a-z0-9]+/u)
    .map((token) => token.trim())
    .filter(Boolean);
}

function inferMutationIntent(message: string): boolean {
  return /\b(create|delete|remove|trash|archive|move|reschedule|schedule|send|reply|forward|block|unsubscribe|update|set|mark)\b/i.test(
    message,
  );
}

function scoreCapability(params: {
  tokens: string[];
  intentFamilies: CapabilityIntentFamily[];
  capability: ReturnType<typeof listCapabilityDefinitions>[number];
  mutateIntent: boolean;
}): number {
  const { capability, tokens, intentFamilies, mutateIntent } = params;
  let score = 0;

  for (const family of intentFamilies) {
    if (capability.intentFamilies.includes(family)) score += 10;
  }

  const haystack = new Set([
    ...capability.tags.map((tag) => tag.toLowerCase()),
    ...tokenize(capability.description),
    ...capability.id.split(".").flatMap((part) => tokenize(part)),
  ]);

  for (const token of tokens) {
    if (haystack.has(token)) score += 3;
    if ([...haystack].some((value) => value.includes(token) || token.includes(value))) {
      score += 1;
    }
  }

  if (mutateIntent && !capability.readOnly) score += 4;
  if (!mutateIntent && capability.readOnly) score += 2;

  return score;
}

export async function selectCandidateCapabilities(params: {
  message: string;
  logger: Logger;
  emailAccount: { id: string; email: string; userId: string };
  topK?: number;
}): Promise<CapabilitySelectionResult> {
  const topK = Math.min(Math.max(params.topK ?? DEFAULT_TOP_K, 6), MAX_TOP_K);
  const semantic = await parseSemanticRequest({
    message: params.message,
    logger: params.logger,
    emailAccount: params.emailAccount,
  });

  const intentFamilies = semantic.intents as CapabilityIntentFamily[];
  const tokens = tokenize(params.message);
  const mutateIntent = inferMutationIntent(params.message);
  const capabilities = listCapabilityDefinitions();

  const ranked = capabilities
    .map((capability) => ({
      id: capability.id,
      score: scoreCapability({
        tokens,
        intentFamilies,
        capability,
        mutateIntent,
      }),
      readOnly: capability.readOnly,
      riskLevel: capability.riskLevel,
    }))
    .sort((a, b) => b.score - a.score);

  let selected = ranked.filter((entry) => entry.score > 0).slice(0, topK);
  if (selected.length === 0) {
    selected = ranked.slice(0, topK);
  }

  // Ensure at least one read capability for grounding.
  if (!selected.some((entry) => entry.readOnly)) {
    const fallbackRead = ranked.find((entry) => entry.readOnly);
    if (fallbackRead) {
      selected = [...selected.slice(0, Math.max(0, topK - 1)), fallbackRead];
    }
  }

  // If mutation intent is present, keep at least one mutating option.
  if (mutateIntent && !selected.some((entry) => !entry.readOnly)) {
    const fallbackMutating = ranked.find((entry) => !entry.readOnly);
    if (fallbackMutating) {
      selected = [...selected.slice(0, Math.max(0, topK - 1)), fallbackMutating];
    }
  }

  const uniqueCandidates: CapabilityName[] = Array.from(
    new Set(selected.map((entry) => entry.id)),
  ) as CapabilityName[];

  return {
    candidates: uniqueCandidates,
    reason:
      uniqueCandidates.length > 0
        ? "scored_capability_candidates"
        : "fallback_all_capabilities",
    semanticConfidence: semantic.confidence,
    intentFamilies: semantic.intents,
  };
}
