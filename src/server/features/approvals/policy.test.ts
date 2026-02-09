import { beforeEach, describe, expect, it, vi } from "vitest";

const { findUniqueMock } = vi.hoisted(() => ({
  findUniqueMock: vi.fn(),
}));

vi.mock("@/server/db/client", () => ({
  default: {
    approvalPreference: {
      findUnique: findUniqueMock,
    },
  },
}));

import { requiresApproval } from "@/features/approvals/policy";

describe("requiresApproval defaults", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("requires approval by default for send", async () => {
    findUniqueMock.mockResolvedValue(null);

    await expect(
      requiresApproval({ userId: "user-1", toolName: "send" }),
    ).resolves.toBe(true);
  });

  it("does not require approval by default for low-risk create/query operations", async () => {
    findUniqueMock.mockResolvedValue(null);

    await expect(
      requiresApproval({ userId: "user-1", toolName: "query" }),
    ).resolves.toBe(false);
    await expect(
      requiresApproval({
        userId: "user-1",
        toolName: "create",
        args: { resource: "email", data: { to: ["a@example.com"] } },
      }),
    ).resolves.toBe(false);
  });

  it("requires approval by default for modify email trash operations", async () => {
    findUniqueMock.mockResolvedValue(null);

    await expect(
      requiresApproval({
        userId: "user-1",
        toolName: "modify",
        args: {
          resource: "email",
          ids: ["msg-1"],
          changes: { trash: true },
        },
      }),
    ).resolves.toBe(true);
  });

  it("respects explicit user preference overrides", async () => {
    findUniqueMock.mockResolvedValue({
      policy: "never",
      conditions: null,
    });

    await expect(
      requiresApproval({ userId: "user-1", toolName: "send" }),
    ).resolves.toBe(false);
  });

  it("evaluates conditional externalOnly policy from nested create args", async () => {
    findUniqueMock.mockResolvedValue({
      policy: "conditional",
      conditions: { externalOnly: true, domains: ["example.com"] },
    });

    await expect(
      requiresApproval({
        userId: "user-1",
        toolName: "create",
        args: {
          resource: "email",
          data: { to: ["john@example.com"] },
        },
      }),
    ).resolves.toBe(false);

    await expect(
      requiresApproval({
        userId: "user-1",
        toolName: "create",
        args: {
          resource: "email",
          data: { to: ["ceo@outside.com"] },
        },
      }),
    ).resolves.toBe(true);
  });

  it("requires approval for conditional policy when recipients cannot be resolved", async () => {
    findUniqueMock.mockResolvedValue({
      policy: "conditional",
      conditions: { externalOnly: true, domains: ["example.com"] },
    });

    await expect(
      requiresApproval({
        userId: "user-1",
        toolName: "create",
        args: { resource: "calendar", data: { title: "Focus block" } },
      }),
    ).resolves.toBe(true);
  });

  it("never requires approval for modify(resource=approval)", async () => {
    findUniqueMock.mockResolvedValue({
      policy: "always",
      conditions: null,
    });

    await expect(
      requiresApproval({
        userId: "user-1",
        toolName: "modify",
        args: {
          resource: "approval",
          ids: ["approval-1"],
          changes: { decision: "APPROVE" },
        },
      }),
    ).resolves.toBe(false);
  });
});
