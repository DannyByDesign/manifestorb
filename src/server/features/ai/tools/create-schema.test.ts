import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("@/server/db/client");
vi.mock("@/server/lib/user/get", () => ({
  getEmailAccountWithAi: vi.fn(),
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

import { createTool } from "./create";

describe("createTool discriminated schema", () => {
  it("accepts email-specific payload", () => {
    const parsed = createTool.parameters.safeParse({
      resource: "email",
      type: "new",
      data: {
        to: ["jane@example.com"],
        subject: "Hello",
        body: "Hi",
      },
    });
    expect(parsed.success).toBe(true);
  });

  it("rejects resource-incompatible payload fields", () => {
    const parsed = createTool.parameters.safeParse({
      resource: "calendar",
      data: {
        title: "Meeting",
        sendOnApproval: true,
      },
    });
    expect(parsed.success).toBe(false);
  });

  it("accepts category resource payload", () => {
    const parsed = createTool.parameters.safeParse({
      resource: "category",
      data: {
        name: "VIP",
      },
    });
    expect(parsed.success).toBe(true);
  });
});
