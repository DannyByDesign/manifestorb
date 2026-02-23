import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AttentionItem } from "@/server/features/ai/proactive/types";

const { userFindManyMock, scanForAttentionItemsMock, createInAppNotificationMock } = vi.hoisted(() => ({
  userFindManyMock: vi.fn(),
  scanForAttentionItemsMock: vi.fn(),
  createInAppNotificationMock: vi.fn(),
}));

vi.mock("@/server/db/client", () => ({
  default: {
    user: {
      findMany: userFindManyMock,
    },
  },
}));

vi.mock("@/server/features/ai/proactive/scanner", () => ({
  scanForAttentionItems: scanForAttentionItemsMock,
}));

vi.mock("@/server/features/notifications/create", () => ({
  createInAppNotification: createInAppNotificationMock,
}));

import { runProactiveAttentionSweep } from "@/server/features/ai/proactive/orchestrator";

function item(overrides: Partial<AttentionItem>): AttentionItem {
  return {
    id: "item-1",
    type: "unanswered_email",
    urgency: "medium",
    title: "Needs reply",
    description: "Email is waiting.",
    actionable: true,
    relatedEntityId: "thread-1",
    relatedEntityType: "email",
    detectedAt: new Date("2026-02-23T00:00:00.000Z"),
    ...overrides,
  };
}

describe("runProactiveAttentionSweep", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    userFindManyMock.mockResolvedValue([
      {
        id: "user-1",
        taskPreferences: { timeZone: "UTC" },
        emailAccounts: [{ timezone: null }],
      },
    ]);
    createInAppNotificationMock.mockResolvedValue({ id: "notification-1" });
  });

  it("creates at most two proactive notifications per user", async () => {
    scanForAttentionItemsMock.mockResolvedValue([
      item({ id: "a", urgency: "high" }),
      item({ id: "b", type: "overdue_task", relatedEntityId: "task-1", relatedEntityType: "task" }),
      item({ id: "c", type: "pending_approval", urgency: "high", relatedEntityId: "approval-1", relatedEntityType: "approval" }),
    ]);

    const stats = await runProactiveAttentionSweep({
      now: new Date("2026-02-23T14:00:00.000Z"),
    });

    expect(stats.notificationsCreated).toBe(2);
    expect(createInAppNotificationMock).toHaveBeenCalledTimes(2);
    const firstCall = createInAppNotificationMock.mock.calls[0]?.[0];
    expect(firstCall.dedupeKey).toContain("proactive:");
  });

  it("suppresses non-urgent notifications during quiet hours", async () => {
    scanForAttentionItemsMock.mockResolvedValue([
      item({ id: "quiet-1", urgency: "medium" }),
    ]);

    const stats = await runProactiveAttentionSweep({
      now: new Date("2026-02-23T02:00:00.000Z"),
    });

    expect(createInAppNotificationMock).not.toHaveBeenCalled();
    expect(stats.skippedQuietHours).toBe(1);
  });

  it("allows pending approvals during quiet hours", async () => {
    scanForAttentionItemsMock.mockResolvedValue([
      item({
        id: "approval-urgent",
        type: "pending_approval",
        urgency: "high",
        relatedEntityId: "approval-2",
        relatedEntityType: "approval",
      }),
    ]);

    const stats = await runProactiveAttentionSweep({
      now: new Date("2026-02-23T02:00:00.000Z"),
    });

    expect(createInAppNotificationMock).toHaveBeenCalledTimes(1);
    expect(stats.notificationsCreated).toBe(1);
  });
});
