import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const { deleteKnowledgeActionMock } = vi.hoisted(() => ({
  deleteKnowledgeActionMock: vi.fn(),
}));

vi.mock("@/server/actions/knowledge", () => ({
  deleteKnowledgeAction: deleteKnowledgeActionMock,
}));

vi.mock("@/server/db/client", () => ({
  default: {
    task: { deleteMany: vi.fn() },
  },
}));

import { deleteTool } from "./delete";

describe("deleteTool knowledge branch", () => {
  it("passes emailAccountId to deleteKnowledgeAction", async () => {
    deleteKnowledgeActionMock.mockResolvedValue(undefined);

    const result = await deleteTool.execute(
      { resource: "knowledge", ids: ["k-1", "k-2"] },
      { emailAccountId: "email-1", userId: "user-1", providers: {} } as any,
    );

    expect(deleteKnowledgeActionMock).toHaveBeenNthCalledWith(1, "email-1", { id: "k-1" });
    expect(deleteKnowledgeActionMock).toHaveBeenNthCalledWith(2, "email-1", { id: "k-2" });
    expect(result).toEqual({ success: true, data: { count: 2 } });
  });

  it("deletes drafts via email provider", async () => {
    const deleteDraft = vi.fn().mockResolvedValue(undefined);

    const result = await deleteTool.execute(
      { resource: "draft", ids: ["d-1", "d-2"] },
      { emailAccountId: "email-1", userId: "user-1", providers: { email: { deleteDraft } } } as any,
    );

    expect(deleteDraft).toHaveBeenNthCalledWith(1, "d-1");
    expect(deleteDraft).toHaveBeenNthCalledWith(2, "d-2");
    expect(result).toEqual({ success: true, data: { count: 2 } });
  });

  it("uses single mode by default for calendar deletes", async () => {
    const deleteEvent = vi.fn().mockResolvedValue(undefined);

    const result = await deleteTool.execute(
      { resource: "calendar", ids: ["evt-1"] },
      { emailAccountId: "email-1", userId: "user-1", providers: { calendar: { deleteEvent } } } as any,
    );

    expect(deleteEvent).toHaveBeenCalledWith({
      calendarId: undefined,
      eventId: "evt-1",
      deleteOptions: { mode: "single" },
    });
    expect(result).toEqual({ success: true, data: { count: 1 } });
  });
});
