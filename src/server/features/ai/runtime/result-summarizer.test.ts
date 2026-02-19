import { describe, expect, it } from "vitest";
import { summarizeRuntimeResults } from "@/server/features/ai/runtime/result-summarizer";

describe("summarizeRuntimeResults", () => {
  it("uses tool-provided message when available instead of lexical first/last rewrites", () => {
    const text = summarizeRuntimeResults({
      request: "what is my most recent email",
      approvalsCount: 0,
      results: [
        {
          success: true,
          message: 'The first unread email is from new@example.com — "Newest message".',
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

    expect(text).toContain("The first unread email is");
    expect(text).toContain("Newest message");
  });
});
