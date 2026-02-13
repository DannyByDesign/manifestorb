import type { SemanticIntent } from "@/server/features/ai/skills/contracts/semantic-request";

export interface IntentFamilyRoute {
  families: SemanticIntent[];
  isMultiIntent: boolean;
  confidence: number;
  clarificationPrompt?: string;
}

export function routeIntentFamilies(input: {
  intents: SemanticIntent[];
  confidence: number;
}): IntentFamilyRoute {
  const families = Array.from(new Set(input.intents));
  if (families.length === 0) {
    return {
      families: [],
      isMultiIntent: false,
      confidence: input.confidence,
      clarificationPrompt:
        "Should I help with inbox actions, calendar actions, or both?",
    };
  }

  return {
    families,
    isMultiIntent: families.length > 1,
    confidence: input.confidence,
  };
}
