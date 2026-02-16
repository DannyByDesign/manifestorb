import { describe, expect, it } from "vitest";
import { resolveRuntimeContextSlotBudget } from "@/server/features/ai/runtime/context/slot-budget";

describe("runtime context slot budgets", () => {
  it("allocates larger budgets for planner than lightweight lanes", () => {
    const conversation = resolveRuntimeContextSlotBudget("conversation_only");
    const planner = resolveRuntimeContextSlotBudget("planner");

    expect(planner.maxChars).toBeGreaterThan(conversation.maxChars);
    expect(planner.maxFacts).toBeGreaterThan(conversation.maxFacts);
    expect(planner.maxHistory).toBeGreaterThan(conversation.maxHistory);
  });
});
