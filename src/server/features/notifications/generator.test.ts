import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { generateNotification } from "@/server/features/notifications/generator";
import { createGenerateText } from "@/server/lib/llms";
import { getModel } from "@/server/lib/llms/model";

vi.mock("@/server/lib/llms", () => ({
  createGenerateText: vi.fn(),
}));
vi.mock("@/server/lib/llms/model", () => ({
  getModel: vi.fn(),
}));

const mockCreateGenerateText = vi.mocked(createGenerateText);
const mockGetModel = vi.mocked(getModel);

const context = {
  type: "email" as const,
  source: "Uber",
  title: "Receipt",
  detail: "$45.23",
  importance: "low" as const,
};

const emailAccount = {
  id: "email-1",
  account: { provider: "google" },
} as any;

describe("generateNotification", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetModel.mockReturnValue({ model: "mock", modelName: "mock" } as any);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("returns cleaned LLM output on success", async () => {
    mockCreateGenerateText.mockReturnValue(async () => ({
      text: "\"Hello from LLM\"",
    }) as any);

    const result = await generateNotification(context, { emailAccount });
    expect(result).toBe("Hello from LLM");
  });

  it("falls back on LLM error", async () => {
    mockCreateGenerateText.mockImplementation(() => {
      throw new Error("LLM down");
    });

    const result = await generateNotification(context, { emailAccount });
    expect(result).toContain("📧 Uber: Receipt - $45.23");
  });

  it("falls back on timeout", async () => {
    vi.useFakeTimers();
    mockCreateGenerateText.mockReturnValue(
      (() => new Promise(() => {})) as any,
    );

    const promise = generateNotification(context, { emailAccount });
    await vi.advanceTimersByTimeAsync(60000);
    const result = await promise;

    expect(result).toContain("📧 Uber: Receipt - $45.23");
  });

  it("uses fallback icon and caps length", async () => {
    mockCreateGenerateText.mockImplementation(() => {
      throw new Error("LLM down");
    });

    const longDetail = "x".repeat(200);
    const result = await generateNotification(
      {
        type: "calendar",
        source: "Calendar",
        title: "Standup",
        detail: longDetail,
        importance: "high",
      },
      { emailAccount },
    );

    expect(result.startsWith("📅")).toBe(true);
    expect(result.length).toBeLessThanOrEqual(150);
  });
});
