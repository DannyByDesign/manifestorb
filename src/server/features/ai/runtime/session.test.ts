import { describe, it, expect } from "vitest";
import type { RuntimeTurnContract } from "@/server/features/ai/runtime/turn-contract";
import {
  resolveRuntimeToolCatalogMaxTools,
  shouldAdmitDangerousTools,
} from "@/server/features/ai/runtime/session";

function baseTurn(overrides: Partial<RuntimeTurnContract> = {}): RuntimeTurnContract {
  return {
    intent: "general",
    domain: "general",
    requestedOperation: "read",
    complexity: "simple",
    routeProfile: "fast",
    routeHint: "conversation_only",
    toolChoice: "none",
    knowledgeSource: "either",
    freshness: "low",
    riskLevel: "low",
    confidence: 0.9,
    toolHints: [],
    source: "compiler_fallback",
    conversationClauses: [],
    taskClauses: [],
    metaConstraints: [],
    needsClarification: false,
    ...overrides,
  };
}

describe("resolveRuntimeToolCatalogMaxTools", () => {
  it("uses the maximum tool catalog size for planner lane turns", () => {
    expect(resolveRuntimeToolCatalogMaxTools(baseTurn({ routeHint: "planner" }))).toBe(96);
  });

  it("does not force a max tool count for non-planner turns", () => {
    expect(resolveRuntimeToolCatalogMaxTools(baseTurn({ routeHint: "single_tool" }))).toBeUndefined();
    expect(resolveRuntimeToolCatalogMaxTools(baseTurn({ routeHint: "conversation_only" }))).toBeUndefined();
  });
});

describe("shouldAdmitDangerousTools", () => {
  it("admits dangerous tools for mutate turns", () => {
    expect(shouldAdmitDangerousTools(baseTurn({ requestedOperation: "mutate" }))).toBe(true);
  });

  it("admits dangerous tools for mixed turns", () => {
    expect(shouldAdmitDangerousTools(baseTurn({ requestedOperation: "mixed" }))).toBe(true);
  });

  it("does not admit dangerous tools for read/meta turns", () => {
    expect(shouldAdmitDangerousTools(baseTurn({ requestedOperation: "read" }))).toBe(false);
    expect(shouldAdmitDangerousTools(baseTurn({ requestedOperation: "meta" }))).toBe(false);
  });
});
