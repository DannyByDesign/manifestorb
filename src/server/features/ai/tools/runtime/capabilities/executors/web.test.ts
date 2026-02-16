import { describe, expect, it, vi } from "vitest";
import { webToolExecutors } from "@/server/features/ai/tools/runtime/capabilities/executors/web";

describe("web runtime executors", () => {
  it("wires web.search and web.fetch to capability handlers", async () => {
    const search = vi.fn(async () => ({ success: true }));
    const fetch = vi.fn(async () => ({ success: true }));
    const capabilities = {
      web: {
        search,
        fetch,
      },
    } as never;

    await webToolExecutors["web.search"]?.({
      args: { query: "hello", count: 3 },
      capabilities,
    });
    await webToolExecutors["web.fetch"]?.({
      args: { url: "https://example.com", extractMode: "text" },
      capabilities,
    });

    expect(search).toHaveBeenCalledWith(
      expect.objectContaining({ query: "hello", count: 3 }),
    );
    expect(fetch).toHaveBeenCalledWith(
      expect.objectContaining({ url: "https://example.com", extractMode: "text" }),
    );
  });
});
