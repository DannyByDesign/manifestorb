import { describe, it, expect, beforeEach, vi } from "vitest";
import { processFilingReply } from "@/server/features/drive/handle-filing-reply";
import prisma from "@/server/lib/__mocks__/prisma";

vi.mock("server-only", () => ({}));
vi.mock("@/server/db/client");
vi.mock("@/features/document-filing/ai/parse-filing-reply", () => ({
  aiParseFilingReply: vi.fn(),
}));

const logger = {
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
  trace: vi.fn(),
  with: vi.fn().mockReturnThis(),
} as any;

describe("processFilingReply", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns early when sender is not user", async () => {
    await processFilingReply({
      emailAccountId: "email-1",
      userEmail: "user@test.com",
      message: {
        id: "msg-1",
        headers: {
          from: "other@test.com",
          subject: "Re: filing",
          "in-reply-to": "msg-123",
        },
      } as any,
      emailProvider: { replyToEmail: vi.fn() } as any,
      emailAccount: { id: "email-1" } as any,
      logger,
    });

    expect(prisma.documentFiling.findUnique).not.toHaveBeenCalled();
  });
});
