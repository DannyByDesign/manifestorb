import { describe, it, expect, vi, beforeEach } from "vitest";
import { cookies } from "next/headers";
import { createReferral } from "@/features/referrals/referral-code";
import { captureException } from "@/server/lib/error";
import { handleReferralOnSignUp, saveTokens } from "@/server/auth";
import prisma from "@/server/lib/__mocks__/prisma";
import { clearSpecificErrorMessages } from "@/server/lib/error-messages";

vi.mock("server-only", () => ({}));
vi.mock("@/server/db/client");
vi.mock("@/server/lib/error-messages", () => ({
  addUserErrorMessage: vi.fn().mockResolvedValue(undefined),
  clearSpecificErrorMessages: vi.fn().mockResolvedValue(undefined),
  ErrorType: {
    ACCOUNT_DISCONNECTED: "Account disconnected",
  },
}));
vi.mock("@googleapis/people", () => ({
  people: vi.fn(),
}));
vi.mock("@googleapis/gmail", () => ({
  auth: {
    OAuth2: vi.fn(),
  },
}));
vi.mock("@/server/lib/encryption", () => ({
  encryptToken: vi.fn((t) => t),
}));

vi.mock("next/headers", () => ({
  cookies: vi.fn(),
}));

vi.mock("@/features/referrals/referral-code", () => ({
  createReferral: vi.fn(),
}));

vi.mock("@/server/lib/error", () => ({
  captureException: vi.fn(),
}));

describe("handleReferralOnSignUp", () => {
  const mockCookies = vi.mocked(cookies);
  const mockCreateReferral = vi.mocked(createReferral);
  const mockCaptureException = vi.mocked(captureException);

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("should create referral when referral code cookie exists", async () => {
    const userId = "user123";
    const email = "user@example.com";
    const referralCode = "ABC123";

    mockCookies.mockResolvedValue({
      get: vi.fn().mockReturnValue({ value: referralCode }),
    } as any);

    mockCreateReferral.mockResolvedValue({} as any);

    await handleReferralOnSignUp({ userId, email });

    expect(mockCreateReferral).toHaveBeenCalledWith(userId, referralCode);
  });

  it("should not create referral when no referral code cookie exists", async () => {
    const userId = "user123";
    const email = "user@example.com";

    mockCookies.mockResolvedValue({
      get: vi.fn().mockReturnValue(undefined),
    } as any);

    await handleReferralOnSignUp({ userId, email });

    expect(mockCreateReferral).not.toHaveBeenCalled();
  });

  it("should handle errors gracefully and not throw", async () => {
    const userId = "user123";
    const email = "user@example.com";
    const referralCode = "ABC123";
    const error = new Error("Referral creation failed");

    mockCookies.mockResolvedValue({
      get: vi.fn().mockReturnValue({ value: referralCode }),
    } as any);

    mockCreateReferral.mockRejectedValue(error);

    // Should not throw
    await expect(
      handleReferralOnSignUp({ userId, email }),
    ).resolves.toBeUndefined();

    expect(mockCaptureException).toHaveBeenCalledWith(error, {
      extra: { userId, email, location: "handleReferralOnSignUp" },
    });
  });

  it("should not create referral when referral code cookie has empty value", async () => {
    const userId = "user123";
    const email = "user@example.com";

    mockCookies.mockResolvedValue({
      get: vi.fn().mockReturnValue({ value: "" }),
    } as any);

    await handleReferralOnSignUp({ userId, email });

    expect(mockCreateReferral).not.toHaveBeenCalled();
  });
});

describe("saveTokens", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("clears disconnectedAt and error messages when saving tokens via emailAccountId", async () => {
    prisma.emailAccount.findUnique.mockResolvedValue({
      accountId: "acc_1",
      userId: "user_1",
    } as any);
    prisma.account.update.mockResolvedValue({ userId: "user_1" } as any);

    await saveTokens({
      emailAccountId: "ea_1",
      tokens: {
        access_token: "new-access",
        refresh_token: "new-refresh",
        expires_at: 123_456_789,
      },
      accountRefreshToken: null,
      provider: "google",
    });

    expect(prisma.emailAccount.findUnique).toHaveBeenCalledWith({
      where: { id: "ea_1" },
      select: { accountId: true, userId: true },
    });
    expect(prisma.account.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "acc_1" },
        data: expect.objectContaining({
          disconnectedAt: null,
        }),
      }),
    );
    expect(clearSpecificErrorMessages).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: "user_1",
        errorTypes: ["Account disconnected"],
      }),
    );
  });

  it("clears disconnectedAt and error messages when saving tokens via providerAccountId", async () => {
    prisma.account.update.mockResolvedValue({ userId: "user_1" } as any);

    await saveTokens({
      providerAccountId: "pa_1",
      tokens: {
        access_token: "new-access",
        refresh_token: "new-refresh",
        expires_at: 123_456_789,
      },
      accountRefreshToken: null,
      provider: "google",
    });

    expect(prisma.account.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          provider_providerAccountId: {
            provider: "google",
            providerAccountId: "pa_1",
          },
        }),
        data: expect.objectContaining({
          disconnectedAt: null,
        }),
      }),
    );
    expect(clearSpecificErrorMessages).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: "user_1",
        errorTypes: ["Account disconnected"],
      }),
    );
  });
});
