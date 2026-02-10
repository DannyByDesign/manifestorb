import { describe, it, expect, beforeEach, vi } from "vitest";
import { createTool } from "@/server/features/ai/tools/create";
import { getEmailAccountWithAi } from "@/server/lib/user/get";

const { requiresApprovalMock, createRequestMock, createInAppNotificationMock } =
  vi.hoisted(() => ({
    requiresApprovalMock: vi.fn(),
    createRequestMock: vi.fn(),
    createInAppNotificationMock: vi.fn(),
  }));

vi.mock("server-only", () => ({}));
vi.mock("@/server/lib/user/get", () => ({
  getEmailAccountWithAi: vi.fn(),
}));
vi.mock("@/features/approvals/policy", () => ({
  requiresApproval: requiresApprovalMock,
}));
vi.mock("@/features/approvals/service", () => ({
  ApprovalService: class {
    createRequest = createRequestMock;
  },
}));
vi.mock("@/features/notifications/create", () => ({
  createInAppNotification: createInAppNotificationMock,
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
    requiresApprovalMock.mockResolvedValue(false);
    createRequestMock.mockResolvedValue({ id: "approval-1" });
    createInAppNotificationMock.mockResolvedValue(null);
  });

  it("creates a draft and returns interactive actions", async () => {
    vi.mocked(getEmailAccountWithAi).mockResolvedValue({
      id: "email-1",
      account: { provider: "google" },
    } as unknown as Awaited<ReturnType<typeof getEmailAccountWithAi>>);

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
      } as unknown as Parameters<typeof createTool.execute>[1],
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

  it("surfaces interactive approval payload when sendOnApproval requires approval", async () => {
    vi.mocked(getEmailAccountWithAi).mockResolvedValue({
      id: "email-1",
      userId: "user-1",
      account: { provider: "google" },
    } as unknown as Awaited<ReturnType<typeof getEmailAccountWithAi>>);
    requiresApprovalMock.mockResolvedValue(true);

    const createDraft = vi.fn().mockResolvedValue({ draftId: "draft-approval-1" });

    const result = await createTool.execute(
      {
        resource: "email",
        type: "new",
        data: {
          to: ["user@test.com"],
          subject: "Need approval",
          body: "Please review",
          sendOnApproval: true,
        },
      },
      {
        userId: "user-1",
        emailAccountId: "email-1",
        providers: { email: { createDraft } },
      } as unknown as Parameters<typeof createTool.execute>[1],
    );

    expect(result.success).toBe(true);
    expect(result.data).toMatchObject({
      draftId: "draft-approval-1",
      approvalId: "approval-1",
      status: "draft_pending_approval",
    });
    expect(result.interactive).toMatchObject({
      type: "approval_request",
      approvalId: "approval-1",
    });
    expect(result.interactive?.actions).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ value: "approve" }),
        expect.objectContaining({ value: "deny" }),
      ]),
    );
    expect(createInAppNotificationMock).toHaveBeenCalledTimes(1);
  });

  it("accepts legacy email type nested under data.type", async () => {
    vi.mocked(getEmailAccountWithAi).mockResolvedValue({
      id: "email-1",
      account: { provider: "google" },
    } as unknown as Awaited<ReturnType<typeof getEmailAccountWithAi>>);

    const createDraft = vi.fn().mockResolvedValue({ draftId: "draft-legacy-type-1" });

    const result = await createTool.execute(
      {
        resource: "email",
        data: {
          type: "new",
          to: ["user@test.com"],
          subject: "Legacy Type",
          body: "Body",
        },
      } as unknown as Parameters<typeof createTool.execute>[0],
      {
        emailAccountId: "email-1",
        providers: { email: { createDraft } },
      } as unknown as Parameters<typeof createTool.execute>[1],
    );

    expect(result.success).toBe(true);
    expect(result.data.draftId).toBe("draft-legacy-type-1");
  });

  it("asks for clarification when new draft body is missing", async () => {
    vi.mocked(getEmailAccountWithAi).mockResolvedValue({
      id: "email-1",
      account: { provider: "google" },
    } as unknown as Awaited<ReturnType<typeof getEmailAccountWithAi>>);

    const createDraft = vi.fn();
    const result = await createTool.execute(
      {
        resource: "email",
        type: "new",
        data: {
          to: ["user@test.com"],
          subject: "Need content",
        },
      },
      {
        emailAccountId: "email-1",
        providers: { email: { createDraft } },
      } as unknown as Parameters<typeof createTool.execute>[1],
    );

    expect(result.success).toBe(false);
    expect(result.clarification?.kind).toBe("missing_fields");
    expect(result.clarification?.prompt).toContain("What should the email say");
    expect(createDraft).not.toHaveBeenCalled();
  });
});
