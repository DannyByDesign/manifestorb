import { describe, it, expect, beforeEach, vi } from "vitest";
import { createTool } from "@/server/features/ai/tools/create";
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

describe("create tool (email)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("creates a draft and returns interactive actions", async () => {
    vi.mocked(getEmailAccountWithAi).mockResolvedValue({
      id: "email-1",
      account: { provider: "google" },
    } as any);

    const createDraft = vi.fn().mockResolvedValue({ draftId: "draft-1" });

    const result = await createTool.execute(
      {
        resource: "email",
        type: "new",
        data: {
          to: ["user@test.com"],
          subject: "Hello",
          body: "Body",
        },
      },
      {
        emailAccountId: "email-1",
        providers: { email: { createDraft } },
      } as any,
    );

    expect(result.success).toBe(true);
    expect(result.data.draftId).toBe("draft-1");
    expect(result.interactive?.actions).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ value: "send" }),
        expect.objectContaining({ value: "discard" }),
      ]),
    );
  });
});
