import { describe, expect, it } from "vitest";
import { resolveRuntimeContextSlotBudget } from "@/server/features/ai/runtime/context/slot-budget";

describe("runtime context slot budgets", () => {
  it("allocates larger budgets for planner than lightweight lanes", () => {
    const conversation = resolveRuntimeContextSlotBudget("conversation_only");
    const evidenceFirst = resolveRuntimeContextSlotBudget("evidence_first");
    const planner = resolveRuntimeContextSlotBudget("planner");

    expect(evidenceFirst.maxChars).toBeGreaterThan(conversation.maxChars);
    expect(evidenceFirst.maxFacts).toBeGreaterThan(conversation.maxFacts);
    expect(evidenceFirst.maxHistory).toBeGreaterThan(conversation.maxHistory);
    expect(planner.maxChars).toBeGreaterThan(conversation.maxChars);
    expect(planner.maxChars).toBeGreaterThan(evidenceFirst.maxChars);
    expect(planner.maxFacts).toBeGreaterThan(conversation.maxFacts);
    expect(planner.maxFacts).toBeGreaterThan(evidenceFirst.maxFacts);
    expect(planner.maxHistory).toBeGreaterThan(conversation.maxHistory);
    expect(planner.maxHistory).toBeGreaterThan(evidenceFirst.maxHistory);
  });
});
