import { beforeEach, describe, expect, it, vi } from "vitest";
import { checkPermissions } from "./security";

vi.mock("server-only", () => ({}));

const { prismaMock } = vi.hoisted(() => ({
  prismaMock: {
    emailAccount: {
      findFirst: vi.fn(),
      findMany: vi.fn(),
    },
    task: {
      findMany: vi.fn(),
    },
    approvalRequest: {
      findMany: vi.fn(),
    },
    inAppNotification: {
      findMany: vi.fn(),
    },
    conversation: {
      findMany: vi.fn(),
    },
    knowledge: {
      findMany: vi.fn(),
    },
    rule: {
      findMany: vi.fn(),
    },
  },
}));

vi.mock("@/env", () => ({
  env: {
    UPSTASH_REDIS_URL: "",
    UPSTASH_REDIS_TOKEN: "",
    NODE_ENV: "test",
  },
}));

vi.mock("@/server/db/client", () => ({
  default: prismaMock,
}));

vi.mock("@/server/lib/redis", () => ({
  redis: {
    incr: vi.fn(),
    expire: vi.fn(),
  },
}));

describe("checkPermissions", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    prismaMock.emailAccount.findFirst.mockResolvedValue({ id: "ea-1" });
    prismaMock.emailAccount.findMany.mockResolvedValue([{ id: "ea-1" }]);
    prismaMock.task.findMany.mockResolvedValue([]);
    prismaMock.approvalRequest.findMany.mockResolvedValue([]);
    prismaMock.inAppNotification.findMany.mockResolvedValue([]);
    prismaMock.conversation.findMany.mockResolvedValue([]);
    prismaMock.knowledge.findMany.mockResolvedValue([]);
    prismaMock.rule.findMany.mockResolvedValue([]);
  });

  it("enforces email-account ownership when context is provided", async () => {
    prismaMock.emailAccount.findFirst.mockResolvedValue(null);
    await expect(
      checkPermissions("user-1", "query", { resource: "email" }, { emailAccountId: "ea-1" }),
    ).rejects.toThrow("Forbidden: email account does not belong to user.");
  });

  it("enforces resource ownership for ID-based operations", async () => {
    prismaMock.task.findMany.mockResolvedValue([]);
    await expect(
      checkPermissions("user-1", "modify", { resource: "task", ids: ["task-1"] }),
    ).rejects.toThrow("Forbidden: task IDs are not owned by user");
  });

  it("allows ID-based operations when ownership matches", async () => {
    prismaMock.task.findMany.mockResolvedValue([{ id: "task-1" }]);
    await expect(
      checkPermissions("user-1", "modify", { resource: "task", ids: ["task-1"] }),
    ).resolves.toBeUndefined();
  });

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
      checkPermissions("user-1", "query", { resource: "unknown_resource" }),
    ).rejects.toThrow("Resource 'unknown_resource' is not allowed for tool 'query'.");
  });

  it("allows resources that are valid for the selected tool", async () => {
    await expect(
      checkPermissions("user-1", "create", { resource: "knowledge" }),
    ).resolves.toBeUndefined();
  });
});
