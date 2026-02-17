import { describe, expect, it } from "vitest";
import { validateEmailSearchFilter } from "@/server/features/ai/tools/runtime/capabilities/validators/email-search";

describe("email search filter validator", () => {
  it("strips trailing temporal phrases from sender scope", () => {
    const result = validateEmailSearchFilter({ from: "Haseeb in the last 7 days" });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.filter.from).toBe("Haseeb");
  });

  it("converts conversation-metadata sender scopes into free text", () => {
    const result = validateEmailSearchFilter({ from: "our conversation memory" });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.filter.from).toBeUndefined();
    expect(result.filter.text).toBe("our conversation memory");
  });

  it("passes through concrete sender scopes", () => {
    const result = validateEmailSearchFilter({ from: "haseeb@fiverr.com" });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.filter.from).toBe("haseeb@fiverr.com");
  });
});
