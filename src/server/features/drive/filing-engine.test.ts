import { describe, it, expect, beforeEach, vi } from "vitest";
import { processAttachment } from "@/server/features/drive/filing-engine";
import prisma from "@/server/lib/__mocks__/prisma";

vi.mock("@/server/db/client");

const logger = {
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
  trace: vi.fn(),
  with: vi.fn().mockReturnThis(),
} as any;

const baseArgs = {
  emailAccount: {
    id: "email-1",
    email: "user@test.com",
    filingEnabled: true,
    filingPrompt: "prompt",
  },
  message: {
    id: "msg-1",
    headers: { subject: "Test", from: "sender@test.com" },
  },
  attachment: {
    attachmentId: "att-1",
    filename: "file.pdf",
    mimeType: "application/pdf",
  },
  emailProvider: {
    getAttachment: vi.fn(),
  },
  logger,
};

describe("processAttachment", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns error when filing disabled", async () => {
    const result = await processAttachment({
      ...baseArgs,
      emailAccount: { ...baseArgs.emailAccount, filingEnabled: false },
    } as any);
    expect(result.success).toBe(false);
    expect(result.error).toBe("Filing not enabled");
  });

  it("returns error when no drive connections", async () => {
    prisma.driveConnection.findMany.mockResolvedValue([]);
    const result = await processAttachment(baseArgs as any);
    expect(result.success).toBe(false);
    expect(result.error).toBe("No connected drives");
  });
});
