import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

vi.mock("server-only", () => ({}));
vi.mock("@/server/db/client");
vi.mock("@/server/auth", () => ({ auth: vi.fn() }));
vi.mock("@/server/lib/user/email-account", () => ({
  findUserEmailAccountWithProvider: vi.fn(),
}));
vi.mock("@/features/approvals/rules", () => ({
  findApprovalRuleById: vi.fn(),
  normalizeApprovalOperationKey: vi.fn((operation?: string) => operation),
  removeApprovalRule: vi.fn(),
  upsertApprovalRule: vi.fn(),
}));

import { auth } from "@/server/auth";
import { findApprovalRuleById, removeApprovalRule } from "@/features/approvals/rules";
import { DELETE } from "./route";

const mockAuth = vi.mocked(auth);
const mockFindApprovalRuleById = vi.mocked(findApprovalRuleById);
const mockRemoveApprovalRule = vi.mocked(removeApprovalRule);

describe("rules by-id API route", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockAuth.mockResolvedValue({ user: { id: "user-1" } } as never);
    mockFindApprovalRuleById.mockResolvedValue({
      toolName: "send",
      defaultPolicy: "always",
      rule: { id: "ar-1", name: "External send requires approval", policy: "always" },
    } as never);
    mockRemoveApprovalRule.mockResolvedValue({ removed: true } as never);
  });

  it("deletes approval rule using unified endpoint", async () => {
    const request = new NextRequest("http://localhost/api/rules/ar-1", {
      method: "DELETE",
      body: JSON.stringify({ type: "approval_rule" }),
    });

    const response = await DELETE(request, { params: Promise.resolve({ id: "ar-1" }) });
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toEqual({ success: true, type: "approval_rule" });
    expect(mockRemoveApprovalRule).toHaveBeenCalledWith({
      userId: "user-1",
      toolName: "send",
      ruleId: "ar-1",
    });
  });
});
