import { describe, expect, it } from "vitest";
import { summarizeRuntimeResults } from "@/server/features/ai/runtime/result-summarizer";

describe("summarizeRuntimeResults", () => {
  it("picks the most recent dated item for latest/most recent requests", () => {
    const text = summarizeRuntimeResults({
      request: "what is my most recent email",
      approvalsCount: 0,
      results: [
        {
          success: true,
          data: [
            {
              title: "Older message",
              from: "old@example.com",
              date: "Sat, 7 Feb 2026 14:01:28 +0000",
            },
            {
              title: "Newest message",
              from: "new@example.com",
              date: "Fri, 13 Feb 2026 17:52:00 +0000",
            },
          ],
        },
      ],
    });

    expect(text).toContain("Your most recent item is");
    expect(text).toContain("Newest message");
    expect(text).not.toContain("Older message");
  });
});
