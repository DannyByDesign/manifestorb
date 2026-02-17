export interface UnifiedRankingWeights {
  lexicalWithSemantic: number;
  lexicalWithoutSemantic: number;
  semantic: number;
  freshness: number;
  authority: number;
  intentSurface: number;
  behavior: number;
  graphProximity: number;
}

export const DEFAULT_UNIFIED_RANKING_WEIGHTS: UnifiedRankingWeights = {
  lexicalWithSemantic: 0.34,
  lexicalWithoutSemantic: 0.52,
  semantic: 0.3,
  freshness: 0.14,
  authority: 0.06,
  intentSurface: 0.08,
  behavior: 0.05,
  graphProximity: 0.03,
};

const RUNTIME_WEIGHTS_ENV_KEY = "UNIFIED_SEARCH_RANKING_WEIGHTS_JSON";
const MIN_WEIGHT = 0;
const MAX_WEIGHT = 4;

let cachedRuntimeWeights: UnifiedRankingWeights | null = null;
let didAttemptRuntimeLoad = false;

function clampWeight(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.min(Math.max(value, MIN_WEIGHT), MAX_WEIGHT);
}

function normalizeModeWeights(
  lexicalWeight: number,
  semanticWeight: number,
  shared: Omit<UnifiedRankingWeights, "lexicalWithSemantic" | "lexicalWithoutSemantic" | "semantic">,
) {
  const total = lexicalWeight +
    semanticWeight +
    shared.freshness +
    shared.authority +
    shared.intentSurface +
    shared.behavior +
    shared.graphProximity;
  if (total <= 0) {
    return {
      lexicalWeight,
      semanticWeight,
      freshness: shared.freshness,
      authority: shared.authority,
      intentSurface: shared.intentSurface,
      behavior: shared.behavior,
      graphProximity: shared.graphProximity,
    };
  }

  return {
    lexicalWeight: lexicalWeight / total,
    semanticWeight: semanticWeight / total,
    freshness: shared.freshness / total,
    authority: shared.authority / total,
    intentSurface: shared.intentSurface / total,
    behavior: shared.behavior / total,
    graphProximity: shared.graphProximity / total,
  };
}

export function normalizeUnifiedRankingWeights(
  candidate: UnifiedRankingWeights,
): UnifiedRankingWeights {
  const shared = {
    freshness: clampWeight(candidate.freshness),
    authority: clampWeight(candidate.authority),
    intentSurface: clampWeight(candidate.intentSurface),
    behavior: clampWeight(candidate.behavior),
    graphProximity: clampWeight(candidate.graphProximity),
  };

  const semanticMode = normalizeModeWeights(
    clampWeight(candidate.lexicalWithSemantic),
    clampWeight(candidate.semantic),
    shared,
  );
  const lexicalMode = normalizeModeWeights(
    clampWeight(candidate.lexicalWithoutSemantic),
    0,
    shared,
  );

  return {
    lexicalWithSemantic: semanticMode.lexicalWeight,
    lexicalWithoutSemantic: lexicalMode.lexicalWeight,
    semantic: semanticMode.semanticWeight,
    freshness: semanticMode.freshness,
    authority: semanticMode.authority,
    intentSurface: semanticMode.intentSurface,
    behavior: semanticMode.behavior,
    graphProximity: semanticMode.graphProximity,
  };
}

function parseRuntimeWeights(
  raw: string | undefined,
): UnifiedRankingWeights | null {
  if (!raw || raw.trim().length === 0) return null;
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== "object") return null;

    const parsedRecord = parsed as Record<string, unknown>;
    const sourceRecord = (
      parsedRecord.weights && typeof parsedRecord.weights === "object"
        ? (parsedRecord.weights as Record<string, unknown>)
        : parsedRecord
    );

    const read = (
      key: keyof UnifiedRankingWeights,
      fallback: number,
    ): number => {
      const value = sourceRecord[key];
      return typeof value === "number" ? value : fallback;
    };

    const merged: UnifiedRankingWeights = {
      lexicalWithSemantic: read(
        "lexicalWithSemantic",
        DEFAULT_UNIFIED_RANKING_WEIGHTS.lexicalWithSemantic,
      ),
      lexicalWithoutSemantic: read(
        "lexicalWithoutSemantic",
        DEFAULT_UNIFIED_RANKING_WEIGHTS.lexicalWithoutSemantic,
      ),
      semantic: read("semantic", DEFAULT_UNIFIED_RANKING_WEIGHTS.semantic),
      freshness: read("freshness", DEFAULT_UNIFIED_RANKING_WEIGHTS.freshness),
      authority: read("authority", DEFAULT_UNIFIED_RANKING_WEIGHTS.authority),
      intentSurface: read(
        "intentSurface",
        DEFAULT_UNIFIED_RANKING_WEIGHTS.intentSurface,
      ),
      behavior: read("behavior", DEFAULT_UNIFIED_RANKING_WEIGHTS.behavior),
      graphProximity: read(
        "graphProximity",
        DEFAULT_UNIFIED_RANKING_WEIGHTS.graphProximity,
      ),
    };
    return normalizeUnifiedRankingWeights(merged);
  } catch {
    return null;
  }
}

export function resolveRuntimeUnifiedRankingWeights(): UnifiedRankingWeights {
  if (didAttemptRuntimeLoad) {
    return cachedRuntimeWeights ?? DEFAULT_UNIFIED_RANKING_WEIGHTS;
  }
  didAttemptRuntimeLoad = true;

  const parsed = parseRuntimeWeights(process.env[RUNTIME_WEIGHTS_ENV_KEY]);
  cachedRuntimeWeights = parsed;
  return parsed ?? DEFAULT_UNIFIED_RANKING_WEIGHTS;
}

export function resetRuntimeUnifiedRankingWeightsForTests() {
  didAttemptRuntimeLoad = false;
  cachedRuntimeWeights = null;
}
