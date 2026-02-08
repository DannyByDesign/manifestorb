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

const { createEmailProviderMock, createCalendarProviderMock, createAutomationProviderMock, createToolDriveProviderMock } =
  vi.hoisted(() => ({
    createEmailProviderMock: vi.fn().mockResolvedValue({}),
    createCalendarProviderMock: vi.fn().mockResolvedValue({}),
    createAutomationProviderMock: vi.fn().mockRejectedValue(new Error("no automation account")),
    createToolDriveProviderMock: vi.fn().mockRejectedValue(new Error("drive unavailable")),
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
vi.mock("./providers/drive", () => ({
  createToolDriveProvider: createToolDriveProviderMock,
}));

import { createAgentTools } from "./index";

describe("createAgentTools provider fallback behavior", () => {
  it("returns tool map even when automation/drive providers are unavailable", async () => {
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
