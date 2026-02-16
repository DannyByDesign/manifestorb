import { describe, it, expect, beforeEach, vi } from "vitest";
import { ensureEmailAccountsWatched } from "@/server/features/email/watch-manager";
import prisma from "@/server/lib/__mocks__/prisma";
import { createEmailProvider } from "@/features/email/provider";

vi.mock("@/server/db/client");
vi.mock("@/features/email/provider", () => ({
  createEmailProvider: vi.fn(),
}));

const logger = {
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
  with: vi.fn().mockReturnThis(),
} as any;

describe("ensureEmailAccountsWatched", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns success when provider watch succeeds", async () => {
    prisma.emailAccount.findMany.mockResolvedValue([
      {
        id: "email-1",
        email: "user@test.com",
        watchEmailsExpirationDate: null,
        watchEmailsSubscriptionId: null,
        account: {
          provider: "google",
          access_token: "a",
          refresh_token: "r",
          expires_at: null,
          disconnectedAt: null,
        },
      },
    ] as any);
    vi.mocked(createEmailProvider).mockResolvedValue({
      name: "google",
      watchEmails: vi.fn().mockResolvedValue({
        expirationDate: new Date(),
        subscriptionId: "sub-1",
      }),
    } as any);

    const result = await ensureEmailAccountsWatched({
      userIds: null,
      logger,
    });

    expect(result[0]?.status).toBe("success");
    expect(prisma.emailAccount.update).toHaveBeenCalled();
  });

  it("returns error when tokens are missing", async () => {
    prisma.emailAccount.findMany.mockResolvedValue([
      {
        id: "email-1",
        email: "user@test.com",
        watchEmailsExpirationDate: null,
        watchEmailsSubscriptionId: null,
        account: {
          provider: "google",
          access_token: null,
          refresh_token: null,
          expires_at: null,
          disconnectedAt: null,
        },
      },
    ] as any);

    const result = await ensureEmailAccountsWatched({
      userIds: null,
      logger,
    });

    expect(result[0]?.status).toBe("error");
  });
});
