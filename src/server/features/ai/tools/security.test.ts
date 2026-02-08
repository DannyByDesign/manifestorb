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
  it("allows known tools with valid resource payloads", async () => {
    await expect(checkPermissions("user-1", "send", {})).resolves.toBeUndefined();
    await expect(
      checkPermissions("user-1", "query", { resource: "email" }),
    ).resolves.toBeUndefined();
    await expect(
      checkPermissions("user-1", "workflow", {
        steps: [
          { action: "query", resource: "email" },
          { action: "modify", resource: "calendar" },
        ],
      }),
    ).resolves.toBeUndefined();
  });

  it("rejects unknown tools", async () => {
    await expect(checkPermissions("user-1", "totallyUnknownTool", {})).rejects.toThrow(
      "Unknown tool 'totallyUnknownTool' is not allowed.",
    );
  });

  it("rejects invalid resources for a tool", async () => {
    await expect(
      checkPermissions("user-1", "query", { resource: "approval" }),
    ).resolves.toBeUndefined();

    await expect(
      checkPermissions("user-1", "query", { resource: "drive" }),
    ).rejects.toThrow("Resource 'drive' is not allowed for tool 'query'.");
  });

  it("rejects quarantined resources by default", async () => {
    await expect(
      checkPermissions("user-1", "create", { resource: "drive" }),
    ).rejects.toThrow("Resource 'drive' is currently quarantined");
  });
});
