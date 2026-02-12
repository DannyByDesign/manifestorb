import { beforeEach, describe, expect, it, vi } from "vitest";
import prisma, { resetPrismaMock } from "@/server/lib/__mocks__/prisma";
import { ContextManager } from "./context-manager";

vi.mock("@/server/db/client");
vi.mock("@/features/memory/embeddings/search", () => ({
  searchMemoryFacts: vi.fn().mockResolvedValue([]),
  searchKnowledge: vi.fn().mockResolvedValue([]),
  searchConversationHistory: vi.fn().mockResolvedValue([]),
}));
vi.mock("@/features/calendar/schedule-proposal", () => ({
  getPendingScheduleProposal: vi.fn().mockResolvedValue(null),
}));
vi.mock("@/features/ai/proactive/scanner", () => ({
  scanForAttentionItems: vi.fn().mockResolvedValue([]),
}));
vi.mock("@/server/lib/posthog", () => ({
  posthogCaptureEvent: vi.fn().mockResolvedValue(undefined),
}));
vi.mock("@/features/calendar/event-provider", () => ({
  createCalendarEventProviders: vi.fn(),
}));

describe("ContextManager upcoming events", () => {
  beforeEach(() => {
    resetPrismaMock();
    prisma.conversationMessage.findMany.mockResolvedValue([]);
    prisma.userSummary.findUnique.mockResolvedValue(null);
    prisma.emailMessage.findMany.mockResolvedValue([]);
    prisma.task.findMany.mockResolvedValue([]);
  });

  it("populates real upcoming events when providers are available", async () => {
    const start = new Date("2026-02-10T10:00:00.000Z");
    const end = new Date("2026-02-10T11:00:00.000Z");
    const { createCalendarEventProviders } = await import(
      "@/features/calendar/event-provider"
    );
    vi.mocked(createCalendarEventProviders).mockResolvedValue([
      {
        provider: "google",
        fetchEventsWithAttendee: vi.fn(),
        fetchEvents: vi.fn().mockResolvedValue([
          {
            id: "evt-1",
            title: "Standup",
            startTime: start,
            endTime: end,
            attendees: [{ email: "a@example.com" }, { email: "b@example.com" }],
          },
        ]),
        getEvent: vi.fn(),
        createEvent: vi.fn(),
        updateEvent: vi.fn(),
        deleteEvent: vi.fn(),
      },
    ] as never);

    const context = await ContextManager.buildContextPack({
      user: { id: "user-1" },
      emailAccount: { id: "email-1", userId: "user-1", about: null } as never,
      messageContent: "what's next",
      options: {
        contextTier: 0,
        includeDomainData: true,
        includePendingState: false,
        includeAttentionItems: false,
      },
    });

    expect(context.domain?.upcomingEvents).toEqual([
      {
        id: "evt-1",
        title: "Standup",
        start,
        end,
        attendees: ["a@example.com", "b@example.com"],
        location: undefined,
      },
    ]);
  });

  it("fails soft when calendar providers throw", async () => {
    const { createCalendarEventProviders } = await import(
      "@/features/calendar/event-provider"
    );
    vi.mocked(createCalendarEventProviders).mockRejectedValue(
      new Error("calendar offline"),
    );

    const context = await ContextManager.buildContextPack({
      user: { id: "user-1" },
      emailAccount: { id: "email-1", userId: "user-1", about: null } as never,
      messageContent: "what's next",
      options: {
        contextTier: 0,
        includeDomainData: true,
        includePendingState: false,
        includeAttentionItems: false,
      },
    });

    expect(context.domain?.upcomingEvents).toEqual([]);
  });
});
