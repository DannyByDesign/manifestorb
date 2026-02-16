import { describe, expect, it } from "vitest";
import { expandToolGroups } from "@/server/features/ai/tools/policy/tool-policy";

describe("tool policy web group", () => {
  it("expands group:web to web.search and web.fetch", () => {
    const expanded = expandToolGroups(["group:web"]);
    expect(expanded).toContain("web.search");
    expect(expanded).toContain("web.fetch");
  });
});
