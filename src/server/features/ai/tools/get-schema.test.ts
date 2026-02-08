import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("@/server/db/client", () => ({ default: {} }));

import { getTool } from "./get";

describe("getTool discriminated schema", () => {
  it("accepts task-specific includeReason", () => {
    const parsed = getTool.parameters.safeParse({
      resource: "task",
      ids: ["task-1"],
      includeReason: true,
    });
    expect(parsed.success).toBe(true);
  });

  it("rejects calendar-incompatible fields", () => {
    const parsed = getTool.parameters.safeParse({
      resource: "calendar",
      ids: ["evt-1"],
      includeReason: true,
    });
    expect(parsed.success).toBe(false);
  });

  it("rejects email-incompatible fields", () => {
    const parsed = getTool.parameters.safeParse({
      resource: "email",
      ids: ["msg-1"],
      calendarId: "primary",
    });
    expect(parsed.success).toBe(false);
  });

  it("accepts draft gets by IDs", () => {
    const parsed = getTool.parameters.safeParse({
      resource: "draft",
      ids: ["draft-1"],
    });
    expect(parsed.success).toBe(true);
  });
});
