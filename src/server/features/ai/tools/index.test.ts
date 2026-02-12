import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

vi.mock("ai", () => ({
  tool: (definition: unknown) => definition,
  zodSchema: (schema: unknown) => schema,
}));

vi.mock("@ai-sdk/google", () => ({
  google: {
    tools: {
      googleSearch: vi.fn(() => ({})),
    },
  },
}));

vi.mock("@/server/lib/llms/model", () => ({
  getModel: vi.fn(() => ({})),
}));

vi.mock("@/server/lib/llms", () => ({
  createGenerateText: vi.fn(() => vi.fn().mockResolvedValue({ text: "ok" })),
}));

const { createEmailProviderMock, createCalendarProviderMock, createAutomationProviderMock } =
  vi.hoisted(() => ({
    createEmailProviderMock: vi.fn().mockResolvedValue({}),
    createCalendarProviderMock: vi.fn().mockResolvedValue({}),
    createAutomationProviderMock: vi.fn().mockRejectedValue(new Error("no automation account")),
  }));

vi.mock("./providers/email", () => ({
  createEmailProvider: createEmailProviderMock,
}));
vi.mock("./providers/calendar", () => ({
  createCalendarProvider: createCalendarProviderMock,
}));
vi.mock("./providers/automation", () => ({
  createAutomationProvider: createAutomationProviderMock,
}));

import { createAgentTools } from "./index";

describe("createAgentTools provider fallback behavior", () => {
  it("returns tool map even when automation provider is unavailable", async () => {
    const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn() } as any;

    const tools = await createAgentTools({
      emailAccount: {
        id: "email-1",
        provider: "google",
        access_token: null,
        refresh_token: null,
        expires_at: null,
        email: "user@example.com",
      },
      logger,
      userId: "user-1",
    });

    expect(createAutomationProviderMock).toHaveBeenCalled();
    expect(tools).toHaveProperty("query");
    expect(tools).toHaveProperty("workflow");
    expect(tools).toHaveProperty("webSearch");
  });
});
