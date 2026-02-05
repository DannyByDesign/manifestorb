import { describe, it, expect, beforeEach, vi } from "vitest";
import { NextResponse } from "next/server";
import { processHistoryForUser } from "@/server/features/email/process-history";
import { GmailLabel } from "@/server/integrations/google/label";
import prisma from "@/server/lib/__mocks__/prisma";

vi.mock("@/server/db/client");
vi.mock("@/server/integrations/google/client", () => ({
  getGmailClientWithRefresh: vi.fn().mockResolvedValue({}),
}));
vi.mock("@/server/integrations/google/history", () => ({
  getHistory: vi.fn(),
}));
vi.mock("@/app/api/google/webhook/process-history-item", () => ({
  processHistoryItem: vi.fn().mockResolvedValue(undefined),
}));
vi.mock("@/features/webhooks/validate-webhook-account", () => ({
  validateWebhookAccount: vi.fn(),
  getWebhookEmailAccount: vi.fn(),
}));

import { getHistory } from "@/server/integrations/google/history";
import { processHistoryItem } from "@/app/api/google/webhook/process-history-item";
import {
  validateWebhookAccount,
  getWebhookEmailAccount,
} from "@/features/webhooks/validate-webhook-account";

const logger = {
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
  with: vi.fn().mockReturnThis(),
} as any;

describe("processHistoryForUser", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns validation response when webhook account invalid", async () => {
    vi.mocked(getWebhookEmailAccount).mockResolvedValue(null as any);
    vi.mocked(validateWebhookAccount).mockResolvedValue({
      success: false,
      response: NextResponse.json({ error: "invalid" }, { status: 401 }),
    } as any);

    const res = await processHistoryForUser(
      { emailAddress: "user@test.com", historyId: 123 },
      {},
      logger,
    );

    expect(res.status).toBe(401);
  });

  it("processes history items and updates lastSyncedHistoryId", async () => {
    vi.mocked(getWebhookEmailAccount).mockResolvedValue({
      id: "email-1",
      email: "user@test.com",
      lastSyncedHistoryId: "0",
    } as any);
    vi.mocked(validateWebhookAccount).mockResolvedValue({
      success: true,
      data: {
        emailAccount: {
          id: "email-1",
          userId: "user-1",
          email: "user@test.com",
          account: {
            provider: "google",
            access_token: "a",
            refresh_token: "r",
          },
          rules: [],
        },
        hasAutomationRules: false,
        hasAiAccess: false,
      },
    } as any);

    vi.mocked(getHistory).mockResolvedValue({
      history: [
        {
          id: "124",
          messagesAdded: [
            {
              message: {
                id: "msg-1",
                threadId: "thread-1",
                labelIds: [GmailLabel.INBOX],
              },
            },
          ],
        },
      ],
    } as any);
    prisma.$executeRaw.mockResolvedValue(undefined as any);

    const res = await processHistoryForUser(
      { emailAddress: "user@test.com", historyId: 124 },
      {},
      logger,
    );

    const json = await res.json();
    expect(json.ok).toBe(true);
    expect(processHistoryItem).toHaveBeenCalled();
    expect(prisma.$executeRaw).toHaveBeenCalled();
  });

  it("returns ok when history id expired", async () => {
    vi.mocked(getWebhookEmailAccount).mockResolvedValue({
      id: "email-1",
      email: "user@test.com",
      lastSyncedHistoryId: "0",
    } as any);
    vi.mocked(validateWebhookAccount).mockResolvedValue({
      success: true,
      data: {
        emailAccount: {
          id: "email-1",
          userId: "user-1",
          email: "user@test.com",
          account: {
            provider: "google",
            access_token: "a",
            refresh_token: "r",
          },
          rules: [],
        },
        hasAutomationRules: false,
        hasAiAccess: false,
      },
    } as any);

    vi.mocked(getHistory).mockRejectedValue({
      response: { status: 404 },
    });
    prisma.$executeRaw.mockResolvedValue(undefined as any);

    const res = await processHistoryForUser(
      { emailAddress: "user@test.com", historyId: 999 },
      {},
      logger,
    );
    const json = await res.json();
    expect(json.ok).toBe(true);
  });
});
