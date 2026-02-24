import { describe, expect, it } from "vitest";
import { validateEmailSearchFilter } from "@/server/features/ai/tools/runtime/capabilities/validators/email-search";

describe("email search filter validator", () => {
  it("preserves trailing temporal phrases in sender scope", () => {
    const result = validateEmailSearchFilter({ from: "Haseeb in the last 7 days" });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.filter.from).toBe("Haseeb in the last 7 days");
  });

  it("preserves conversation-metadata sender scopes as sender filters", () => {
    const result = validateEmailSearchFilter({ from: "our conversation memory" });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.filter.from).toBe("our conversation memory");
    expect(result.filter.text).toBeUndefined();
  });

  it("passes through concrete sender scopes", () => {
    const result = validateEmailSearchFilter({ from: "haseeb@fiverr.com" });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.filter.from).toBe("haseeb@fiverr.com");
  });
});
