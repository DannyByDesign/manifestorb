import { describe, expect, it } from "vitest";
import {
  classifyRuntimeSemanticContract,
  rankSemanticIntentScores,
} from "@/server/features/ai/runtime/semantic-contract";

describe("runtime semantic contract ranking", () => {
  it("computes top/second intent margin", () => {
    const ranked = rankSemanticIntentScores([
      { intent: "inbox_read", score: 0.91 },
      { intent: "calendar_read", score: 0.83 },
      { intent: "general", score: 0.41 },
    ]);

    expect(ranked).not.toBeNull();
    expect(ranked?.top.intent).toBe("inbox_read");
    expect(ranked?.second.intent).toBe("calendar_read");
    expect(ranked?.margin).toBeCloseTo(0.08, 5);
  });

  it("handles a single score entry", () => {
    const ranked = rankSemanticIntentScores([
      { intent: "greeting", score: 0.77 },
    ]);

    expect(ranked).not.toBeNull();
    expect(ranked?.top.intent).toBe("greeting");
    expect(ranked?.second.intent).toBe("greeting");
    expect(ranked?.margin).toBe(0);
  });

  it("returns null for empty scores", () => {
    expect(rankSemanticIntentScores([])).toBeNull();
  });
});

describe("runtime semantic contract lexical fallback", () => {
  it("classifies greeting as fast meta turn when embedding is unavailable in tests", async () => {
    const contract = await classifyRuntimeSemanticContract({ message: "hello" });

    expect(contract.intent).toBe("greeting");
    expect(contract.routeProfile).toBe("fast");
    expect(contract.requestedOperation).toBe("meta");
    expect(contract.source).toBe("lexical");
  });
});
