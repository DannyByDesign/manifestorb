import { describe, it, expect, vi, beforeEach } from "vitest";
import { saveTokens } from "@/server/auth";
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
