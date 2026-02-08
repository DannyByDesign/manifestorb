import { describe, expect, it, vi } from "vitest";
import { checkPermissions } from "./security";

vi.mock("server-only", () => ({}));

vi.mock("@/env", () => ({
  env: {
    UPSTASH_REDIS_URL: "",
    UPSTASH_REDIS_TOKEN: "",
    NODE_ENV: "test",
  },
}));

vi.mock("@/server/lib/redis", () => ({
  redis: {
    incr: vi.fn(),
    expire: vi.fn(),
  },
}));

describe("checkPermissions", () => {
  it("allows known tools, including dangerous tools gated elsewhere", async () => {
    await expect(checkPermissions("user-1", "send", {})).resolves.toBeUndefined();
    await expect(checkPermissions("user-1", "workflow", {})).resolves.toBeUndefined();
    await expect(checkPermissions("user-1", "query", {})).resolves.toBeUndefined();
  });

  it("rejects unknown tools", async () => {
    await expect(checkPermissions("user-1", "totallyUnknownTool", {})).rejects.toThrow(
      "Unknown tool 'totallyUnknownTool' is not allowed.",
    );
  });
});
