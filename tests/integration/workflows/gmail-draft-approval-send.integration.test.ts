import { describe, it, expect, vi } from "vitest";
import { emailToolExecutors } from "@/server/features/ai/tools/runtime/capabilities/executors/email";

describe("E2E gmail draft approval send", () => {
  it("creates draft then sends it", async () => {
    const createDraft = vi.fn().mockResolvedValue({
      success: true,
      data: { draftId: "draft-1" },
    });
    const sendDraft = vi.fn().mockResolvedValue({
      success: true,
      data: { messageId: "msg-1", threadId: "thread-1" },
    });

    const capabilities = {
      email: {
        createDraft,
        sendDraft,
      },
    } as never;

    const draftResult = await emailToolExecutors["email.createDraft"]?.({
      args: {
        to: ["user@test.com"],
        subject: "Hi",
        body: "Body",
        type: "new",
      },
      capabilities,
    });

    expect(draftResult).toEqual({
      success: true,
      data: { draftId: "draft-1" },
    });

    const sendResult = await emailToolExecutors["email.sendDraft"]?.({
      args: { draftId: "draft-1" },
      capabilities,
    });

    expect(sendResult).toEqual({
      success: true,
      data: { messageId: "msg-1", threadId: "thread-1" },
    });
  });

  it("passes cc and bcc through when creating a draft", async () => {
    const createDraft = vi.fn().mockResolvedValue({ success: true });

    const capabilities = {
      email: {
        createDraft,
      },
    } as never;

    const result = await emailToolExecutors["email.createDraft"]?.({
      args: {
        to: ["user@test.com"],
        cc: ["cc@test.com"],
        bcc: ["bcc@test.com"],
        subject: "Hello",
        body: "Body",
        type: "new",
      },
      capabilities,
    });

    expect(createDraft).toHaveBeenCalledWith(
      expect.objectContaining({
        cc: ["cc@test.com"],
        bcc: ["bcc@test.com"],
      }),
    );
    expect(result).toEqual({ success: true });
  });
});
