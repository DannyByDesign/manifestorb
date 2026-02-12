import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

vi.mock("@/env", () => ({
  env: {
    NEXT_PUBLIC_CALENDAR_SCHEDULING_ENABLED: true,
  },
}));

const { prismaMock } = vi.hoisted(() => ({
  prismaMock: {
    emailAccount: {
      findUnique: vi.fn(),
    },
    emailMessage: {
      findFirst: vi.fn(),
    },
    calendar: {
      findFirst: vi.fn(),
    },
    taskPreference: {
      findUnique: vi.fn(),
    },
  },
}));

vi.mock("@/server/db/client", () => ({
  default: prismaMock,
}));

vi.mock("@/features/calendar/scheduling/TaskSchedulingService", () => ({
  scheduleTasksForUser: vi.fn().mockResolvedValue(undefined),
  resolveSchedulingEmailAccountId: vi.fn(),
}));

import { createTool } from "@/server/features/ai/tools/create";
type CreateToolContext = Parameters<typeof createTool.execute>[1];

describe("create tool (calendar attendees)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    prismaMock.emailAccount.findUnique.mockResolvedValue({
      email: "owner@example.com",
      timezone: "America/Los_Angeles",
    });
    prismaMock.emailMessage.findFirst.mockResolvedValue(null);
    prismaMock.calendar.findFirst.mockResolvedValue(null);
    prismaMock.taskPreference.findUnique.mockResolvedValue(null);
  });

  it("requires clarification for broad group references like 'my team'", async () => {
    const createEvent = vi.fn();
    const result = await createTool.execute(
      {
        resource: "calendar",
        data: {
          title: "Schedule a meeting with my team",
          start: "2026-02-18T15:00:00-08:00",
          end: "2026-02-18T16:00:00-08:00",
        },
      },
      {
        userId: "user-1",
        emailAccountId: "email-1",
        providers: {
          email: {
            searchContacts: vi.fn().mockResolvedValue([
              { email: "a@example.com", name: "Alice Example" },
            ]),
          },
          calendar: {
            createEvent,
            searchEvents: vi.fn().mockResolvedValue([]),
          },
        },
      } as unknown as CreateToolContext,
    );

    expect(result.success).toBe(false);
    expect(result.error).toContain("broad group reference");
    expect(result.data).toMatchObject({
      needsClarification: true,
      reason: "unresolved_attendees",
    });
    expect(createEvent).not.toHaveBeenCalled();
  });

  it("auto-resolves person-level attendee references from contacts", async () => {
    const createEvent = vi.fn().mockResolvedValue({ id: "evt-1" });
    const searchContacts = vi.fn().mockImplementation(async (query: string) => {
      if (query.toLowerCase().includes("yingying")) {
        return [
          { email: "iamsunyy@gmail.com", name: "Yingying S" },
          { email: "someoneelse@example.com", name: "Someone Else" },
        ];
      }
      return [];
    });

    const result = await createTool.execute(
      {
        resource: "calendar",
        data: {
          title: "Schedule with Yingying Sun",
          start: "2026-02-18T15:00:00-08:00",
          end: "2026-02-18T16:00:00-08:00",
        },
      },
      {
        userId: "user-1",
        emailAccountId: "email-1",
        providers: {
          email: {
            searchContacts,
          },
          calendar: {
            createEvent,
            searchEvents: vi.fn().mockResolvedValue([]),
          },
        },
      } as unknown as CreateToolContext,
    );

    expect(result.success).toBe(true);
    expect(createEvent).toHaveBeenCalledTimes(1);
    expect(createEvent.mock.calls[0][0].input.attendees).toEqual([
      "iamsunyy@gmail.com",
    ]);
    expect(result.message).toContain("resolved from your contacts");
  });

  it("resolves pronoun attendee references from source email context", async () => {
    prismaMock.emailMessage.findFirst.mockResolvedValue({
      from: "Yingying S <iamsunyy@gmail.com>",
      to: "Owner <owner@example.com>",
    });
    const createEvent = vi.fn().mockResolvedValue({ id: "evt-2" });

    const result = await createTool.execute(
      {
        resource: "calendar",
        data: {
          title: "Set up a meeting with them next week",
          start: "2026-02-18T15:00:00-08:00",
          end: "2026-02-18T16:00:00-08:00",
        },
      },
      {
        userId: "user-1",
        emailAccountId: "email-1",
        emailMessageId: "gmail-message-123",
        providers: {
          email: {
            searchContacts: vi.fn().mockResolvedValue([]),
          },
          calendar: {
            createEvent,
            searchEvents: vi.fn().mockResolvedValue([]),
          },
        },
      } as unknown as CreateToolContext,
    );

    expect(result.success).toBe(true);
    expect(createEvent).toHaveBeenCalledTimes(1);
    expect(createEvent.mock.calls[0][0].input.attendees).toEqual([
      "iamsunyy@gmail.com",
    ]);
  });

  it("requires confirmation for medium-confidence contact matches", async () => {
    const createEvent = vi.fn().mockResolvedValue({ id: "evt-3" });
    const searchContacts = vi.fn().mockImplementation(async (query: string) => {
      if (query.toLowerCase() === "jane doe") {
        return [
          { email: "jane.doe@acme.com", name: "Jane Doe" },
          { email: "jane@acme.com", name: "Jane" },
        ];
      }
      if (query.toLowerCase() === "jane") {
        return [
          { email: "jane.doe@acme.com", name: "Jane Doe" },
          { email: "jane@acme.com", name: "Jane" },
        ];
      }
      if (query.toLowerCase() === "doe") {
        return [{ email: "jane.doe@acme.com", name: "Jane Doe" }];
      }
      return [];
    });

    const result = await createTool.execute(
      {
        resource: "calendar",
        data: {
          title: "Set up a meeting with Jane Doe",
          start: "2026-02-18T15:00:00-08:00",
          end: "2026-02-18T16:00:00-08:00",
        },
      },
      {
        userId: "user-1",
        emailAccountId: "email-1",
        providers: {
          email: {
            searchContacts,
          },
          calendar: {
            createEvent,
            searchEvents: vi.fn().mockResolvedValue([]),
          },
        },
      } as unknown as CreateToolContext,
    );

    expect(result.success).toBe(false);
    expect(result.error).toContain("Please confirm this attendee");
    expect(result.data).toMatchObject({
      needsClarification: true,
      reason: "attendee_confirmation_required",
      suggestedAttendees: ["jane.doe@acme.com"],
    });
    expect(createEvent).not.toHaveBeenCalled();
  });

  it("requires confirmation when explicit attendee conflicts with pronoun context", async () => {
    prismaMock.emailMessage.findFirst.mockResolvedValue({
      from: "Yingying S <iamsunyy@gmail.com>",
      to: "Owner <owner@example.com>",
    });
    const createEvent = vi.fn().mockResolvedValue({ id: "evt-4" });

    const result = await createTool.execute(
      {
        resource: "calendar",
        data: {
          title: "Set up a meeting with them",
          attendees: ["wrong.person@example.com"],
          start: "2026-02-18T15:00:00-08:00",
          end: "2026-02-18T16:00:00-08:00",
        },
      },
      {
        userId: "user-1",
        emailAccountId: "email-1",
        emailMessageId: "gmail-message-123",
        providers: {
          email: {
            searchContacts: vi.fn().mockResolvedValue([]),
          },
          calendar: {
            createEvent,
          },
        },
      } as unknown as CreateToolContext,
    );

    expect(result.success).toBe(false);
    expect(result.error).toContain("context mismatch");
    expect(result.data).toMatchObject({
      needsClarification: true,
      reason: "attendee_confirmation_required",
      attendeeResolutionReason: "explicit_context_conflict",
      suggestedAttendees: ["wrong.person@example.com"],
      alternatives: ["iamsunyy@gmail.com"],
    });
    expect(createEvent).not.toHaveBeenCalled();
  });
});
