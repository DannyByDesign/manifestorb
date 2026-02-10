import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("@/server/db/client", () => ({ default: {} }));
vi.mock("@/server/lib/user/get", () => ({
  getEmailAccountWithAi: vi.fn(),
}));

import { queryTool } from "./query";

describe("queryTool discriminated schema", () => {
  it("rejects quarantined/unsupported resources", () => {
    const parsed = queryTool.parameters.safeParse({
      resource: "patterns",
      filter: {},
    });
    expect(parsed.success).toBe(false);
  });

  it("rejects resource-incompatible filter fields", () => {
    const parsed = queryTool.parameters.safeParse({
      resource: "email",
      filter: { status: "PENDING" },
    });
    expect(parsed.success).toBe(false);
  });

  it("accepts resource-specific email filters", () => {
    const parsed = queryTool.parameters.safeParse({
      resource: "email",
      filter: {
        query: "from:john@example.com",
        subjectContains: "E2E",
        text: "cleanup",
        fetchAll: true,
        subscriptionsOnly: true,
        limit: 100,
      },
    });
    expect(parsed.success).toBe(true);
  });

  it("accepts resource-specific calendar semantic filters", () => {
    const parsed = queryTool.parameters.safeParse({
      resource: "calendar",
      filter: {
        titleContains: "1:1",
        locationContains: "Zoom",
        attendeeEmail: "john@example.com",
        timeZone: "Europe/London",
        limit: 20,
      },
    });
    expect(parsed.success).toBe(true);
  });

  it("accepts plain-text filter strings and maps them to resource defaults", () => {
    const parsed = queryTool.parameters.safeParse({
      resource: "email",
      filter: "find emails from mom last week",
    });
    expect(parsed.success).toBe(true);
    if (parsed.success) {
      expect(parsed.data.filter?.text).toBe("find emails from mom last week");
    }
  });

  it("rejects unknown top-level keys to avoid silent argument drops", () => {
    const parsed = queryTool.parameters.safeParse({
      resource: "email",
      filter: { query: "from:john@example.com" },
      extra: "unexpected",
    });
    expect(parsed.success).toBe(false);
  });
});
