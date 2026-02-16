import { describe, expect, it } from "vitest";
import { resolveRuntimeContextSlotBudget } from "@/server/features/ai/runtime/context/slot-budget";

describe("runtime context slot budgets", () => {
  it("allocates larger budgets for deeper lanes", () => {
    const fast = resolveRuntimeContextSlotBudget("planner_fast");
    const deep = resolveRuntimeContextSlotBudget("planner_deep");

    expect(deep.maxChars).toBeGreaterThan(fast.maxChars);
    expect(deep.maxFacts).toBeGreaterThan(fast.maxFacts);
    expect(deep.maxHistory).toBeGreaterThan(fast.maxHistory);
  });
});
