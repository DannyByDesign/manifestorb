import { describe, expect, it } from "vitest";
import {
  calibrateRankingWeights,
  evaluateRankingWeights,
  type RankingEvalCase,
} from "@/server/features/search/unified/calibration";
import { DEFAULT_UNIFIED_RANKING_WEIGHTS } from "@/server/features/search/unified/weights";

const EVAL_CASES: RankingEvalCase[] = [
  {
    id: "q1",
    query: "portfolio review email sent",
    docs: [
      {
        id: "best",
        lexical: 0.6,
        semantic: 0.75,
        freshness: 0.6,
        authority: 0.4,
        intentSurface: 1,
        behavior: 0.95,
        graphProximity: 0.4,
        relevance: 3,
      },
      {
        id: "lexical_trap",
        lexical: 0.95,
        semantic: 0.2,
        freshness: 0.5,
        authority: 0.4,
        intentSurface: 0.4,
        behavior: 0.05,
        graphProximity: 0.1,
        relevance: 0,
      },
    ],
  },
  {
    id: "q2",
    query: "budget calendar meeting",
    docs: [
      {
        id: "cal_best",
        lexical: 0.7,
        semantic: 0.8,
        freshness: 0.8,
        authority: 0.6,
        intentSurface: 1,
        behavior: 0.7,
        graphProximity: 0.6,
        relevance: 3,
      },
      {
        id: "cal_other",
        lexical: 0.85,
        semantic: 0.3,
        freshness: 0.4,
        authority: 0.4,
        intentSurface: 0.5,
        behavior: 0.1,
        graphProximity: 0.2,
        relevance: 1,
      },
    ],
  },
];

function objective(ndcgAt10: number, mrrAt10: number): number {
  return ndcgAt10 * 0.8 + mrrAt10 * 0.2;
}

describe("search ranking calibration", () => {
  it("evaluates metrics for an eval set", () => {
    const metrics = evaluateRankingWeights({
      evalCases: EVAL_CASES,
      weights: DEFAULT_UNIFIED_RANKING_WEIGHTS,
    });
    expect(metrics.ndcgAt10).toBeGreaterThanOrEqual(0);
    expect(metrics.ndcgAt10).toBeLessThanOrEqual(1);
    expect(metrics.mrrAt10).toBeGreaterThanOrEqual(0);
    expect(metrics.mrrAt10).toBeLessThanOrEqual(1);
  });

  it("finds non-regressive weights over baseline", () => {
    const result = calibrateRankingWeights({ evalCases: EVAL_CASES });
    const baselineObjective = objective(
      result.baseline.ndcgAt10,
      result.baseline.mrrAt10,
    );
    const optimizedObjective = objective(
      result.optimized.ndcgAt10,
      result.optimized.mrrAt10,
    );
    expect(optimizedObjective).toBeGreaterThanOrEqual(baselineObjective);
  });
});
