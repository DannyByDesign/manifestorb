import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

vi.mock("server-only", () => ({}));
vi.mock("@/server/db/client");
vi.mock("@/server/auth", () => ({ auth: vi.fn() }));
vi.mock("@/server/lib/user/email-account", () => ({
  findUserEmailAccountWithProvider: vi.fn(),
}));
vi.mock("@/features/policies/service", () => ({
  listAssistantPolicies: vi.fn(),
}));
vi.mock("@/features/approvals/rules", () => ({
  getApprovalOperationLabel: vi.fn((operation: string) => operation),
  normalizeApprovalOperationKey: vi.fn((operation?: string) => operation),
  upsertApprovalRule: vi.fn(),
}));

import { auth } from "@/server/auth";
import { findUserEmailAccountWithProvider } from "@/server/lib/user/email-account";
import { listAssistantPolicies } from "@/features/policies/service";
import { upsertApprovalRule } from "@/features/approvals/rules";
import { GET, POST } from "./route";

const mockAuth = vi.mocked(auth);
const mockFindEmailAccount = vi.mocked(findUserEmailAccountWithProvider);
const mockListAssistantPolicies = vi.mocked(listAssistantPolicies);
const mockUpsertApprovalRule = vi.mocked(upsertApprovalRule);

describe("rules API route", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockAuth.mockResolvedValue({ user: { id: "user-1" } } as never);
    mockFindEmailAccount.mockResolvedValue({
      id: "email-1",
      about: "About me",
      account: { provider: "google" },
    } as never);
    mockListAssistantPolicies.mockResolvedValue({
      preferences: {},
      emailRules: [],
      rulePlaneRules: [],
      approvalRules: [],
      summary: { emailRuleCount: 0, approvalRuleCount: 0 },
    } as never);
  });

  it("returns 401 when unauthenticated", async () => {
    mockAuth.mockResolvedValue(null as never);
    const response = await GET();
    expect(response.status).toBe(401);
  });

  it("returns combined email + approval rules with summary", async () => {
    mockListAssistantPolicies.mockResolvedValue({
      preferences: {},
      emailRules: [{ id: "er-1", name: "Archive newsletters" }],
      rulePlaneRules: [],
      approvalRules: [
        {
          id: "ar-1",
          name: "External send requires approval",
          toolName: "send",
          operation: "send_email",
          policy: "always",
          enabled: true,
          disabledUntil: undefined,
          conditions: undefined,
          priority: 10,
        },
      ],
      summary: { emailRuleCount: 1, approvalRuleCount: 1 },
    } as never);

    const response = await GET();
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.summary).toEqual({
      totalEmailRules: 1,
      totalApprovalRules: 1,
    });
    expect(body.emailRules).toHaveLength(1);
    expect(body.approvalRules).toHaveLength(1);
  });

  it("creates approval rule through unified POST endpoint", async () => {
    mockUpsertApprovalRule.mockResolvedValue({
      toolName: "send",
      defaultPolicy: "always",
      rule: { id: "ar-1", name: "External send requires approval" },
    } as never);

    const request = new NextRequest("http://localhost/api/rules", {
      method: "POST",
      body: JSON.stringify({
        type: "approval_rule",
        toolName: "send",
        name: "External send requires approval",
        policy: "always",
        operation: "send_email",
      }),
    });

    const response = await POST(request);
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.type).toBe("approval_rule");
    expect(mockUpsertApprovalRule).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: "user-1",
        toolName: "send",
      }),
    );
  });
});
