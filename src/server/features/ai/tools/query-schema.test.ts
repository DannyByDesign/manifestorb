import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("@/server/db/client", () => ({ default: {} }));
vi.mock("@/server/lib/user/get", () => ({
  getEmailAccountWithAi: vi.fn(),
}));

import { queryTool } from "./query";

describe("queryTool discriminated schema", () => {
  it("requires filter.id for patterns queries", () => {
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
      filter: { query: "from:john@example.com", fetchAll: true, limit: 100 },
    });
    expect(parsed.success).toBe(true);
  });
});
