import { describe, expect, it } from "vitest";
import { listInternalToolPacks } from "@/server/features/ai/tools/packs/registry";
import { loadRuntimeToolDefinitionsFromPacks } from "@/server/features/ai/tools/packs/loader";

describe("internal tool packs", () => {
  it("registers and loads the web pack tools", () => {
    const packs = listInternalToolPacks();
    const webPack = packs.find((pack) => pack.id === "web");
    expect(webPack).toBeDefined();
    expect(webPack?.tools).toContain("web.search");
    expect(webPack?.tools).toContain("web.fetch");

    const runtimeTools = loadRuntimeToolDefinitionsFromPacks();
    const names = runtimeTools.map((tool) => tool.toolName);
    expect(names).toContain("web.search");
    expect(names).toContain("web.fetch");
  });
});
