import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AttentionItem } from "@/server/features/ai/proactive/types";

const {
  userFindManyMock,
  scanForAttentionItemsMock,
  createInAppNotificationMock,
  canRunProactiveAttentionMock,
  recordProactiveAttentionRunMock,
} = vi.hoisted(() => ({
  userFindManyMock: vi.fn(),
  scanForAttentionItemsMock: vi.fn(),
  createInAppNotificationMock: vi.fn(),
  canRunProactiveAttentionMock: vi.fn(),
  recordProactiveAttentionRunMock: vi.fn(),
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

vi.mock("@/server/features/billing/usage", () => ({
  canRunProactiveAttention: canRunProactiveAttentionMock,
  recordProactiveAttentionRun: recordProactiveAttentionRunMock,
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
    canRunProactiveAttentionMock.mockResolvedValue({
      allowed: true,
      monthlyProactiveRuns: 0,
      proactiveRunCap: 600,
    });
    recordProactiveAttentionRunMock.mockResolvedValue(undefined);
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

  it("skips proactive execution when usage cap blocks the user", async () => {
    canRunProactiveAttentionMock.mockResolvedValue({
      allowed: false,
      reason: "proactive_run_cap",
      monthlyProactiveRuns: 600,
      proactiveRunCap: 600,
    });
    scanForAttentionItemsMock.mockResolvedValue([
      item({ id: "blocked-1", urgency: "high" }),
    ]);

    const stats = await runProactiveAttentionSweep({
      now: new Date("2026-02-23T14:00:00.000Z"),
    });

    expect(scanForAttentionItemsMock).not.toHaveBeenCalled();
    expect(createInAppNotificationMock).not.toHaveBeenCalled();
    expect(stats.skippedUsageLimit).toBe(1);
  });
});
