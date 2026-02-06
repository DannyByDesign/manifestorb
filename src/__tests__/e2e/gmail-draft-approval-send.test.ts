import { describe, it, expect, vi, beforeEach } from "vitest";
import { createTool } from "@/server/features/ai/tools/create";
import { sendTool } from "@/server/features/ai/tools/send";
import { getEmailAccountWithAi } from "@/server/lib/user/get";

vi.mock("server-only", () => ({}));
vi.mock("@/server/lib/user/get", () => ({
  getEmailAccountWithAi: vi.fn(),
}));
const MockChannelRouter = vi.hoisted(
  () =>
    class {
      pushMessage = vi.fn();
    },
);

vi.mock("@/features/channels/router", () => ({
  ChannelRouter: MockChannelRouter,
}));
vi.mock("@/server/db/client");

describe("E2E gmail draft approval send", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("creates draft then sends it", async () => {
    vi.mocked(getEmailAccountWithAi).mockResolvedValue({
      id: "email-1",
      account: { provider: "google" },
    } as any);

    const createDraft = vi.fn().mockResolvedValue({ draftId: "draft-1" });
    const sendDraft = vi.fn().mockResolvedValue({
      messageId: "msg-1",
      threadId: "thread-1",
    });

    const draftResult = await createTool.execute(
      {
        resource: "email",
        type: "new",
        data: { to: ["user@test.com"], subject: "Hi", body: "Body" },
      },
      {
        emailAccountId: "email-1",
        providers: { email: { createDraft } },
      } as any,
    );

    expect(draftResult.success).toBe(true);
    const sendResult = await sendTool.execute(
      { draftId: "draft-1" },
      { providers: { email: { sendDraft } } } as any,
    );

    expect(sendResult.success).toBe(true);
  });

  it("passes cc and bcc through when creating a draft", async () => {
    vi.mocked(getEmailAccountWithAi).mockResolvedValue({
      id: "email-1",
      account: { provider: "google" },
    } as unknown as object);

    const createDraft = vi.fn().mockResolvedValue({ draftId: "draft-2" });

    const result = await createTool.execute(
      {
        resource: "email",
        type: "new",
        data: {
          to: ["user@test.com"],
          cc: ["cc@test.com"],
          bcc: ["bcc@test.com"],
          subject: "Hello",
          body: "Body",
        },
      },
      {
        emailAccountId: "email-1",
        userId: "user-1",
        providers: { email: { createDraft } },
      } as unknown as object,
    );

    expect(createDraft).toHaveBeenCalledWith(
      expect.objectContaining({
        cc: ["cc@test.com"],
        bcc: ["bcc@test.com"],
      }),
    );
    expect(result.success).toBe(true);
    expect(result.interactive?.preview.cc).toEqual(["cc@test.com"]);
    expect(result.interactive?.preview.bcc).toEqual(["bcc@test.com"]);
  });
});
