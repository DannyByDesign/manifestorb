import { beforeEach, describe, expect, it, vi } from "vitest";
import { triageTool } from "./triage";
import { triageTasks } from "@/features/tasks/triage/TaskTriageService";
import type { ToolContext } from "./types";
import type { EmailProvider } from "./providers/email";
import type { CalendarProvider } from "./providers/calendar";
import type { AutomationProvider } from "./providers/automation";

vi.mock("server-only", () => ({}));
vi.mock("@/features/tasks/triage/TaskTriageService", () => ({
  triageTasks: vi.fn(),
}));

describe("triageTool", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("delegates to triageTasks and returns a success response", async () => {
    const triageResult = {
      ranked: [],
      followUpQuestions: ["What should I work on?"],
      meta: { candidateCount: 0, openTaskCount: 0 },
    };
    vi.mocked(triageTasks).mockResolvedValue(triageResult);

    const context: ToolContext = {
      userId: "user-1",
      emailAccountId: "email-1",
      logger: {
        info: vi.fn(),
        warn: vi.fn(),
        error: vi.fn(),
        trace: vi.fn(),
      },
      providers: {
        email: {} as unknown as EmailProvider,
        calendar: {} as unknown as CalendarProvider,
        automation: {} as unknown as AutomationProvider,
      },
    };

    const result = await triageTool.execute(
      { message: "help me prioritize" },
      context,
    );

    expect(vi.mocked(triageTasks)).toHaveBeenCalledWith({
      userId: "user-1",
      emailAccountId: "email-1",
      logger: context.logger,
      messageContent: "help me prioritize",
    });
    expect(result).toEqual({
      success: true,
      data: triageResult,
    });
  });
});
