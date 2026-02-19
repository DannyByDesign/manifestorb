import { beforeEach, describe, expect, it, vi } from "vitest";
import prisma from "@/server/lib/__mocks__/prisma";
import { cleanupInvalidTokens } from "./cleanup-invalid-tokens";
import { sendReconnectionEmail } from "@amodel/resend";
import { createScopedLogger } from "@/server/lib/logger";
import { addUserErrorMessage } from "@/server/lib/error-messages";
import { recordInvalidGrantFailure } from "@/server/auth/oauth-refresh-failure-policy";

const logger = createScopedLogger("test");

vi.mock("@/server/db/client");
vi.mock("@amodel/resend", () => ({
  sendReconnectionEmail: vi.fn(),
}));
vi.mock("@/server/auth/oauth-refresh-failure-policy", () => ({
  recordInvalidGrantFailure: vi.fn(),
}));
vi.mock("@/server/lib/error-messages", () => ({
  addUserErrorMessage: vi.fn().mockResolvedValue(undefined),
  ErrorType: {
    ACCOUNT_DISCONNECTED: "Account disconnected",
  },
}));
vi.mock("@/server/lib/unsubscribe", () => ({
  createUnsubscribeToken: vi.fn().mockResolvedValue("mock-token"),
}));

describe("cleanupInvalidTokens", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  const mockEmailAccount = {
    id: "ea_1",
    email: "test@example.com",
    accountId: "acc_1",
    userId: "user_1",
    account: { disconnectedAt: null, provider: "google" },
    watchEmailsExpirationDate: new Date(Date.now() + 1000 * 60 * 60), // Valid expiration
  };

  it("defers disconnect for early invalid_grant failures", async () => {
    prisma.emailAccount.findUnique.mockResolvedValue(mockEmailAccount as any);
    vi.mocked(recordInvalidGrantFailure).mockResolvedValue({
      shouldDisconnect: false,
      attempts: 1,
      threshold: 3,
    });

    const result = await cleanupInvalidTokens({
      emailAccountId: "ea_1",
      reason: "invalid_grant",
      logger,
    });

    expect(result).toEqual({ status: "deferred", attempts: 1, threshold: 3 });
    expect(prisma.account.updateMany).not.toHaveBeenCalled();
    expect(sendReconnectionEmail).not.toHaveBeenCalled();
    expect(addUserErrorMessage).not.toHaveBeenCalled();
  });

  it("marks account as disconnected and sends email on confirmed invalid_grant when account is watched", async () => {
    prisma.emailAccount.findUnique.mockResolvedValue(mockEmailAccount as any);
    prisma.account.updateMany.mockResolvedValue({ count: 1 });
    vi.mocked(recordInvalidGrantFailure).mockResolvedValue({
      shouldDisconnect: true,
      attempts: 3,
      threshold: 3,
    });

    const result = await cleanupInvalidTokens({
      emailAccountId: "ea_1",
      reason: "invalid_grant",
      logger,
    });

    expect(result).toEqual({ status: "disconnected" });
    expect(prisma.account.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "acc_1", disconnectedAt: null },
        data: expect.objectContaining({
          access_token: null,
          expires_at: null,
          disconnectedAt: expect.any(Date),
        }),
      }),
    );
    expect(sendReconnectionEmail).toHaveBeenCalled();
    expect(addUserErrorMessage).toHaveBeenCalledWith(
      "user_1",
      "Account disconnected",
      expect.stringContaining("test@example.com"),
      logger,
    );
  });

  it("marks as disconnected but skips email if account is not watched", async () => {
    prisma.emailAccount.findUnique.mockResolvedValue({
      ...mockEmailAccount,
      watchEmailsExpirationDate: null,
    } as any);
    prisma.account.updateMany.mockResolvedValue({ count: 1 });
    vi.mocked(recordInvalidGrantFailure).mockResolvedValue({
      shouldDisconnect: true,
      attempts: 3,
      threshold: 3,
    });

    const result = await cleanupInvalidTokens({
      emailAccountId: "ea_1",
      reason: "invalid_grant",
      logger,
    });

    expect(result).toEqual({ status: "disconnected" });
    expect(prisma.account.updateMany).toHaveBeenCalled();
    expect(sendReconnectionEmail).not.toHaveBeenCalled();
    expect(addUserErrorMessage).toHaveBeenCalledWith(
      "user_1",
      "Account disconnected",
      expect.stringContaining("test@example.com"),
      logger,
    );
  });

  it("returns early if account is already disconnected", async () => {
    prisma.emailAccount.findUnique.mockResolvedValue({
      ...mockEmailAccount,
      account: { disconnectedAt: new Date() },
    } as any);

    const result = await cleanupInvalidTokens({
      emailAccountId: "ea_1",
      reason: "invalid_grant",
      logger,
    });

    expect(result).toEqual({ status: "already_disconnected" });
    expect(prisma.account.updateMany).not.toHaveBeenCalled();
    expect(sendReconnectionEmail).not.toHaveBeenCalled();
  });

  it("does not send email for insufficient_permissions", async () => {
    prisma.emailAccount.findUnique.mockResolvedValue(mockEmailAccount as any);
    prisma.account.updateMany.mockResolvedValue({ count: 1 });

    const result = await cleanupInvalidTokens({
      emailAccountId: "ea_1",
      reason: "insufficient_permissions",
      logger,
    });

    expect(result).toEqual({ status: "disconnected" });
    expect(prisma.account.updateMany).toHaveBeenCalled();
    expect(sendReconnectionEmail).not.toHaveBeenCalled();
    expect(addUserErrorMessage).not.toHaveBeenCalled();
  });
});
