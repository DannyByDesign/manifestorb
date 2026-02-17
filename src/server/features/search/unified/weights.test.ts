import { afterEach, describe, expect, it } from "vitest";
import {
  DEFAULT_UNIFIED_RANKING_WEIGHTS,
  normalizeUnifiedRankingWeights,
  resetRuntimeUnifiedRankingWeightsForTests,
  resolveRuntimeUnifiedRankingWeights,
} from "@/server/features/search/unified/weights";

const ENV_KEY = "UNIFIED_SEARCH_RANKING_WEIGHTS_JSON";

describe("unified ranking weights", () => {
  afterEach(() => {
    delete process.env[ENV_KEY];
    resetRuntimeUnifiedRankingWeightsForTests();
  });

  it("normalizes both semantic and lexical-only modes", () => {
    const weights = normalizeUnifiedRankingWeights({
      lexicalWithSemantic: 2,
      lexicalWithoutSemantic: 3,
      semantic: 2,
      freshness: 1,
      authority: 1,
      intentSurface: 1,
      behavior: 1,
      graphProximity: 1,
    });

    const semanticTotal =
      weights.lexicalWithSemantic +
      weights.semantic +
      weights.freshness +
      weights.authority +
      weights.intentSurface +
      weights.behavior +
      weights.graphProximity;
    const lexicalOnlyTotal =
      weights.lexicalWithoutSemantic +
      weights.freshness +
      weights.authority +
      weights.intentSurface +
      weights.behavior +
      weights.graphProximity;

    expect(Math.abs(semanticTotal - 1)).toBeLessThan(1e-6);
    expect(lexicalOnlyTotal).toBeGreaterThan(0.5);
    expect(lexicalOnlyTotal).toBeLessThanOrEqual(1);
  });

  it("loads runtime overrides from env json", () => {
    process.env[ENV_KEY] = JSON.stringify({
      weights: {
        lexicalWithSemantic: 0.2,
        lexicalWithoutSemantic: 0.4,
        semantic: 0.5,
        freshness: 0.1,
        authority: 0.1,
        intentSurface: 0.1,
        behavior: 0.4,
        graphProximity: 0.1,
      },
    });
    resetRuntimeUnifiedRankingWeightsForTests();

    const resolved = resolveRuntimeUnifiedRankingWeights();
    expect(resolved.behavior).toBeGreaterThan(DEFAULT_UNIFIED_RANKING_WEIGHTS.behavior);
    expect(resolved.semantic).toBeGreaterThan(0);
  });
});
