import type { UnifiedRankingWeights } from "@/server/features/search/unified/weights";
import {
  DEFAULT_UNIFIED_RANKING_WEIGHTS,
  normalizeUnifiedRankingWeights,
} from "@/server/features/search/unified/weights";

export interface RankingEvalDocument {
  id: string;
  lexical: number;
  semantic?: number;
  freshness: number;
  authority: number;
  intentSurface: number;
  behavior: number;
  graphProximity: number;
  relevance: number;
}

export interface RankingEvalCase {
  id: string;
  query: string;
  docs: RankingEvalDocument[];
}

export interface RankingEvalMetrics {
  ndcgAt10: number;
  mrrAt10: number;
}

export interface RankingCalibrationResult {
  weights: UnifiedRankingWeights;
  baseline: RankingEvalMetrics;
  optimized: RankingEvalMetrics;
}

export function computeRankingScore(params: {
  doc: RankingEvalDocument;
  weights: UnifiedRankingWeights;
  hasSemantic: boolean;
}): number {
  const w = params.weights;
  const lexicalWeight = params.hasSemantic
    ? w.lexicalWithSemantic
    : w.lexicalWithoutSemantic;
  const semanticWeight = params.hasSemantic ? w.semantic : 0;

  const score =
    params.doc.lexical * lexicalWeight +
    (params.doc.semantic ?? 0) * semanticWeight +
    params.doc.freshness * w.freshness +
    params.doc.authority * w.authority +
    params.doc.intentSurface * w.intentSurface +
    params.doc.behavior * w.behavior +
    params.doc.graphProximity * w.graphProximity;

  return Number.isFinite(score) ? score : 0;
}

function dcgAtK(relevances: number[], k: number): number {
  let sum = 0;
  for (let i = 0; i < Math.min(k, relevances.length); i += 1) {
    const rel = Math.max(0, relevances[i] ?? 0);
    const numerator = (2 ** rel) - 1;
    const denominator = Math.log2(i + 2);
    sum += numerator / denominator;
  }
  return sum;
}

function ndcgAtK(rankedRelevances: number[], k: number): number {
  const ideal = [...rankedRelevances].sort((a, b) => b - a);
  const idcg = dcgAtK(ideal, k);
  if (idcg <= 0) return 1;
  return dcgAtK(rankedRelevances, k) / idcg;
}

function reciprocalRankAtK(rankedRelevances: number[], k: number): number {
  for (let i = 0; i < Math.min(k, rankedRelevances.length); i += 1) {
    if ((rankedRelevances[i] ?? 0) > 0) {
      return 1 / (i + 1);
    }
  }
  return 0;
}

export function evaluateRankingWeights(params: {
  evalCases: RankingEvalCase[];
  weights: UnifiedRankingWeights;
}): RankingEvalMetrics {
  if (params.evalCases.length === 0) {
    return { ndcgAt10: 0, mrrAt10: 0 };
  }

  let ndcgSum = 0;
  let mrrSum = 0;
  const weights = normalizeUnifiedRankingWeights(params.weights);

  for (const item of params.evalCases) {
    const hasSemantic = item.docs.some(
      (doc) => typeof doc.semantic === "number" && Number.isFinite(doc.semantic),
    );
    const ranked = [...item.docs].sort((a, b) => {
      const scoreDiff =
        computeRankingScore({ doc: b, weights, hasSemantic }) -
        computeRankingScore({ doc: a, weights, hasSemantic });
      if (Math.abs(scoreDiff) > 1e-9) return scoreDiff;
      return b.relevance - a.relevance;
    });
    const relevances = ranked.map((doc) => doc.relevance);
    ndcgSum += ndcgAtK(relevances, 10);
    mrrSum += reciprocalRankAtK(relevances, 10);
  }

  return {
    ndcgAt10: ndcgSum / params.evalCases.length,
    mrrAt10: mrrSum / params.evalCases.length,
  };
}

function objective(metrics: RankingEvalMetrics): number {
  return metrics.ndcgAt10 * 0.8 + metrics.mrrAt10 * 0.2;
}

function tweakWeight(
  weights: UnifiedRankingWeights,
  key: keyof UnifiedRankingWeights,
  delta: number,
): UnifiedRankingWeights {
  return normalizeUnifiedRankingWeights({
    ...weights,
    [key]: (weights[key] ?? 0) + delta,
  });
}

export function calibrateRankingWeights(params: {
  evalCases: RankingEvalCase[];
  initialWeights?: UnifiedRankingWeights;
}): RankingCalibrationResult {
  const baselineWeights = normalizeUnifiedRankingWeights(
    params.initialWeights ?? DEFAULT_UNIFIED_RANKING_WEIGHTS,
  );
  const baseline = evaluateRankingWeights({
    evalCases: params.evalCases,
    weights: baselineWeights,
  });

  let currentWeights = baselineWeights;
  let currentMetrics = baseline;
  let currentObjective = objective(currentMetrics);

  const steps = [0.2, 0.1, 0.05, 0.02, 0.01];
  const keys: Array<keyof UnifiedRankingWeights> = [
    "lexicalWithSemantic",
    "lexicalWithoutSemantic",
    "semantic",
    "freshness",
    "authority",
    "intentSurface",
    "behavior",
    "graphProximity",
  ];

  for (const step of steps) {
    let improved = true;
    while (improved) {
      improved = false;
      for (const key of keys) {
        for (const direction of [1, -1] as const) {
          const candidate = tweakWeight(currentWeights, key, step * direction);
          const metrics = evaluateRankingWeights({
            evalCases: params.evalCases,
            weights: candidate,
          });
          const score = objective(metrics);
          if (score > currentObjective + 1e-6) {
            currentWeights = candidate;
            currentMetrics = metrics;
            currentObjective = score;
            improved = true;
          }
        }
      }
    }
  }

  return {
    weights: currentWeights,
    baseline,
    optimized: currentMetrics,
  };
}
