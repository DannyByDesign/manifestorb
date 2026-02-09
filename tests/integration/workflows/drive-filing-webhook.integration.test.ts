import { describe, it, expect, beforeEach, vi } from "vitest";
import { processAttachment } from "@/server/features/drive/filing-engine";
import { POST as driveWebhook } from "@/app/api/google/drive/webhook/route";
import prisma from "@/server/lib/__mocks__/prisma";
import { syncGoogleDriveChanges } from "@/server/features/drive/sync/google";

vi.mock("@/server/db/client");
vi.mock("@/features/drive/provider", () => ({
  createDriveProviderWithRefresh: vi.fn(),
}));
vi.mock("@/features/drive/folder-utils", () => ({
  createAndSaveFilingFolder: vi.fn(),
}));
vi.mock("@/features/drive/document-extraction", () => ({
  extractTextFromDocument: vi.fn().mockResolvedValue({ text: "content" }),
  isExtractableMimeType: vi.fn().mockReturnValue(true),
}));
vi.mock("@/features/document-filing/ai/analyze-document", () => ({
  analyzeDocument: vi.fn().mockResolvedValue({
    action: "use_existing",
    folderId: "folder-1",
    confidence: 0.9,
    reasoning: "ok",
  }),
}));
vi.mock("@/features/drive/filing-notifications", () => ({
  sendFiledNotification: vi.fn(),
  sendAskNotification: vi.fn(),
}));
vi.mock("@/server/features/drive/sync/google", () => ({
  syncGoogleDriveChanges: vi.fn().mockResolvedValue({ changed: false, changes: [] }),
}));

import { createDriveProviderWithRefresh } from "@/features/drive/provider";
import { extractTextFromDocument } from "@/features/drive/document-extraction";

const logger = {
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
  trace: vi.fn(),
  with: vi.fn().mockReturnThis(),
} as any;

describe("E2E drive filing + webhook", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    prisma.driveConnection.findMany.mockResolvedValue([
      { id: "conn-1", provider: "google" },
    ] as any);
    prisma.filingFolder.findMany.mockResolvedValue([
      {
        folderId: "folder-1",
        folderName: "Receipts",
        folderPath: "Receipts",
        driveConnectionId: "conn-1",
        driveConnection: { provider: "google" },
      },
    ] as any);
    prisma.documentFiling.create.mockResolvedValue({
      id: "filing-1",
      status: "FILED",
    } as any);
    vi.mocked(createDriveProviderWithRefresh).mockResolvedValue({
      uploadFile: vi.fn().mockResolvedValue({ id: "file-1" }),
    } as any);
  });

  it("files attachment and processes drive webhook", async () => {
    const result = await processAttachment({
      emailAccount: {
        id: "email-1",
        email: "user@test.com",
        filingEnabled: true,
        filingPrompt: "prompt",
      } as any,
      message: {
        id: "msg-1",
        threadId: "thread-1",
        headers: { subject: "Receipt", from: "sender@test.com", "message-id": "m1" },
      } as any,
      attachment: {
        attachmentId: "att-1",
        filename: "file.pdf",
        mimeType: "application/pdf",
      } as any,
      emailProvider: {
        getAttachment: vi.fn().mockResolvedValue({ data: Buffer.from("x").toString("base64") }),
      } as any,
      logger,
    });

    expect(result.success).toBe(true);
    expect(vi.mocked(extractTextFromDocument)).toHaveBeenCalled();

    prisma.driveConnection.findFirst.mockResolvedValue({
      id: "conn-1",
      provider: "google",
      isConnected: true,
      accessToken: "a",
      refreshToken: "r",
      expiresAt: null,
      emailAccountId: "email-1",
      googleChannelId: "ch-1",
      googleResourceId: "res-1",
      googleChannelToken: "token-1",
      googleChannelExpiresAt: null,
      googleStartPageToken: null,
    } as any);

    const res = await driveWebhook(
      new Request("http://localhost/api/google/drive/webhook", {
        method: "POST",
        headers: {
          "x-goog-channel-id": "ch-1",
          "x-goog-resource-id": "res-1",
          "x-goog-channel-token": "token-1",
        },
      }),
    );

    expect(res.status).toBe(200);
    expect(syncGoogleDriveChanges).toHaveBeenCalled();
  });
});
