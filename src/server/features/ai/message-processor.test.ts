import { describe, expect, it } from "vitest";
import {
  claimsDraftWasCreated,
} from "@/features/ai/response-guards";
import { normalizeAuthoritativeHistory } from "@/features/ai/authoritative-history";

describe("message-processor helper guards", () => {
  it("detects fabricated draft-completion claims", () => {
    expect(
      claimsDraftWasCreated("I've drafted a generic test email for you."),
    ).toBe(true);
    expect(
      claimsDraftWasCreated("Your draft is ready and saved to your drafts."),
    ).toBe(true);
    expect(
      claimsDraftWasCreated("I can draft that now if you want."),
    ).toBe(false);
  });

});

describe("message-processor authoritative history normalization", () => {
  it("keeps only user/assistant messages and trims content", () => {
    const normalized = normalizeAuthoritativeHistory([
      { role: "user", content: " hello " },
      { role: "assistant", content: " world " },
      { role: "assistant", content: "   " },
    ]);

    expect(normalized).toEqual([
      { role: "user", content: "hello" },
      { role: "assistant", content: "world" },
    ]);
  });

  it("caps history by total character budget", () => {
    const large = "x".repeat(19_999);
    const normalized = normalizeAuthoritativeHistory([
      { role: "user", content: large },
      { role: "assistant", content: "tail" },
    ]);

    expect(normalized).toEqual([{ role: "user", content: large }]);
  });
});
