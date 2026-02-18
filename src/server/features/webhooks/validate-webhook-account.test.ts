import { describe, it, expect, vi, beforeEach } from "vitest";
import { validateWebhookAccount } from "./validate-webhook-account";
import type { ValidatedWebhookAccountData } from "./validate-webhook-account";
import { createScopedLogger } from "@/server/lib/logger";

const logger = createScopedLogger("test");

vi.mock("@/server/db/client");
vi.mock("@/server/features/policy-plane/repository", () => ({
  listEffectiveCanonicalRules: vi.fn(),
}));
vi.mock("server-only", () => ({}));

import { listEffectiveCanonicalRules } from "@/server/features/policy-plane/repository";

describe("validateWebhookAccount", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(listEffectiveCanonicalRules).mockResolvedValue([
      {
        id: "rule-id",
        version: 1,
        type: "automation",
        enabled: true,
        priority: 0,
        match: {
          resource: "email",
          conditions: [],
        },
        source: {
          mode: "system",
        },
      },
    ] as never);
  });

  function createMockEmailAccount(
    overrides: Partial<ValidatedWebhookAccountData> = {},
  ): ValidatedWebhookAccountData {
    return {
      id: "account-id",
      email: "user@test.com",
      userId: "user-id",
      about: "Test account",
      lastSyncedHistoryId: null,
      autoCategorizeSenders: false,
      watchEmailsSubscriptionId: "subscription-id",
      multiRuleSelectionEnabled: false,
      aiRuleTimeoutMs: null,
      timezone: null,
      calendarBookingLink: null,
      watchEmailsSubscriptionHistory: [],
      account: {
        provider: "google",
        access_token: "access-token",
        refresh_token: "refresh-token",
        expires_at: new Date(),
        disconnectedAt: null,
      },
      user: { id: "user-id" },
      ...overrides,
    };
  }

  it("returns failure when emailAccount is null", async () => {
    const result = await validateWebhookAccount(null, logger);

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(await result.response.json()).toEqual({ ok: true });
    }
  });

  it("returns failure when account is disconnected", async () => {
    const emailAccount = createMockEmailAccount({
      account: {
        provider: "google",
        access_token: "access-token",
        refresh_token: "refresh-token",
        expires_at: new Date(),
        disconnectedAt: new Date(),
      },
    });

    const result = await validateWebhookAccount(emailAccount, logger);

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(await result.response.json()).toEqual({ ok: true });
    }
  });

  it("returns success when account has no active automation rules (but hasAutomationRules=false)", async () => {
    vi.mocked(listEffectiveCanonicalRules).mockResolvedValue([] as never);

    const emailAccount = createMockEmailAccount();
    const result = await validateWebhookAccount(emailAccount, logger);

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data).toEqual({
        emailAccount,
        hasAutomationRules: false,
        hasAiAccess: true,
      });
    }
  });

  it("returns failure when access_token is missing", async () => {
    const emailAccount = createMockEmailAccount({
      account: {
        provider: "google",
        access_token: null,
        refresh_token: "refresh-token",
        expires_at: new Date(),
        disconnectedAt: null,
      },
    });

    const result = await validateWebhookAccount(emailAccount, logger);

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(await result.response.json()).toEqual({ ok: true });
    }
  });

  it("returns failure when refresh_token is missing", async () => {
    const emailAccount = createMockEmailAccount({
      account: {
        provider: "google",
        access_token: "access-token",
        refresh_token: null,
        expires_at: new Date(),
        disconnectedAt: null,
      },
    });

    const result = await validateWebhookAccount(emailAccount, logger);

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(await result.response.json()).toEqual({ ok: true });
    }
  });

  it("returns failure when account relation is null", async () => {
    const emailAccount = {
      ...createMockEmailAccount(),
      account: null,
    } as unknown as ValidatedWebhookAccountData;

    const result = await validateWebhookAccount(emailAccount, logger);

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(await result.response.json()).toEqual({ ok: true });
    }
  });

  it("returns success when validation passes", async () => {
    const emailAccount = createMockEmailAccount();

    const result = await validateWebhookAccount(emailAccount, logger);

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data).toEqual({
        emailAccount,
        hasAutomationRules: true,
        hasAiAccess: true,
      });
    }
  });
});
