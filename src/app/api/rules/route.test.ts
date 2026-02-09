import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

vi.mock("server-only", () => ({}));
vi.mock("@/server/db/client");
vi.mock("@/server/auth", () => ({ auth: vi.fn() }));
vi.mock("@/server/lib/user/email-account", () => ({
  findUserEmailAccountWithProvider: vi.fn(),
}));
vi.mock("@/features/rules/management", () => ({
  listEmailRules: vi.fn(),
  resumePausedEmailRules: vi.fn(),
}));
vi.mock("@/features/approvals/rules", () => ({
  listApprovalRuleConfigs: vi.fn(),
  getApprovalOperationLabel: vi.fn((operation: string) => operation),
  normalizeApprovalOperationKey: vi.fn((operation?: string) => operation),
  upsertApprovalRule: vi.fn(),
}));

import { auth } from "@/server/auth";
import { findUserEmailAccountWithProvider } from "@/server/lib/user/email-account";
import { listEmailRules, resumePausedEmailRules } from "@/features/rules/management";
import { listApprovalRuleConfigs, upsertApprovalRule } from "@/features/approvals/rules";
import { GET, POST } from "./route";

const mockAuth = vi.mocked(auth);
const mockFindEmailAccount = vi.mocked(findUserEmailAccountWithProvider);
const mockListEmailRules = vi.mocked(listEmailRules);
const mockResumePausedEmailRules = vi.mocked(resumePausedEmailRules);
const mockListApprovalRuleConfigs = vi.mocked(listApprovalRuleConfigs);
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
    mockResumePausedEmailRules.mockResolvedValue({ count: 0 } as never);
    mockListEmailRules.mockResolvedValue([] as never);
    mockListApprovalRuleConfigs.mockResolvedValue([] as never);
  });

  it("returns 401 when unauthenticated", async () => {
    mockAuth.mockResolvedValue(null as never);
    const response = await GET();
    expect(response.status).toBe(401);
  });

  it("returns combined email + approval rules with summary", async () => {
    mockListEmailRules.mockResolvedValue([{ id: "er-1", name: "Archive newsletters" }] as never);
    mockListApprovalRuleConfigs.mockResolvedValue([
      {
        toolName: "send",
        defaultPolicy: "always",
        rules: [
          {
            id: "ar-1",
            name: "External send requires approval",
            operation: "send_email",
            policy: "always",
            enabled: true,
            disabledUntil: undefined,
            conditions: undefined,
            priority: 10,
          },
        ],
      },
    ] as never);

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
