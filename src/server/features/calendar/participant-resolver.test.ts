import { describe, expect, it, vi } from "vitest";

vi.mock("@/server/db/client", () => ({
  default: {
    emailMessage: { findFirst: vi.fn() },
    conversationMessage: { findMany: vi.fn() },
    approvalRequest: { findMany: vi.fn() },
  },
}));
import { resolveCalendarAttendees } from "@/features/calendar/participant-resolver";

describe("resolveCalendarAttendees", () => {
  it("resolves pronoun references from contextual attendees", async () => {
    const result = await resolveCalendarAttendees({
      requestedAttendees: undefined,
      title: "Set up a meeting with them tomorrow",
      currentMessage: "set up a meeting with them tomorrow at 3",
      userEmail: "me@example.com",
      contextualAttendees: ["boss@example.com"],
      searchContacts: async () => [],
    });

    expect(result).toMatchObject({
      participantIntent: true,
      confidence: "high",
      attendees: ["boss@example.com"],
      reason: "resolved_from_context",
    });
  });

  it("asks for confirmation when group references map to contextual candidates", async () => {
    const result = await resolveCalendarAttendees({
      requestedAttendees: undefined,
      title: "schedule with my team next week",
      currentMessage: "please set up a meeting with my team next week",
      userEmail: "me@example.com",
      contextualAttendees: ["a@example.com", "b@example.com", "c@example.com"],
      searchContacts: async () => [],
    });

    expect(result).toMatchObject({
      participantIntent: true,
      confidence: "medium",
      attendees: [],
      reason: "contextual_group_reference",
    });
    expect(result.candidateEmails).toEqual([
      "a@example.com",
      "b@example.com",
      "c@example.com",
    ]);
  });
});
