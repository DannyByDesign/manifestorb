/** biome-ignore-all lint/style/noMagicNumbers: test */
import { describe, expect, test, vi } from "vitest";
import { sendTool } from "@/server/features/ai/tools/send";

describe("send tool", () => {
  test("executes sendDraft and returns success", async () => {
    const sendDraft = vi.fn().mockResolvedValue({
      messageId: "msg-1",
      threadId: "thread-1",
    });

    const result = await sendTool.execute(
      { draftId: "draft-1" },
      { providers: { email: { sendDraft } } } as any,
    );

    expect(sendDraft).toHaveBeenCalledWith("draft-1");
    expect(result.success).toBe(true);
    expect(result.data.messageId).toBe("msg-1");
  });
});
