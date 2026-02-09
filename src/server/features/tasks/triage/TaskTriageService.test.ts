import { beforeEach, describe, expect, it, vi } from "vitest";
import { triageTasks } from "./TaskTriageService";
import prisma from "@/server/lib/__mocks__/prisma";
import { createGenerateObject } from "@/server/lib/llms";
import { getModel } from "@/server/lib/llms/model";
import { buildTaskTriageContext } from "./context";

vi.mock("server-only", () => ({}));
vi.mock("@/server/db/client");
vi.mock("@/server/lib/llms", () => ({ createGenerateObject: vi.fn() }));
vi.mock("@/server/lib/llms/model", () => ({ getModel: vi.fn(() => ({ model: "mock" })) }));
vi.mock("./context", () => ({ buildTaskTriageContext: vi.fn() }));

const logger = {
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
  trace: vi.fn(),
  with: vi.fn().mockReturnThis(),
  flush: vi.fn().mockResolvedValue(undefined),
};

const baseContext = {
  tasks: [],
  taskPreferences: null,
  schedulingReasons: {},
  recentCompletions: [],
  availability: {
    windowStart: "2024-01-01T00:00:00.000Z",
    windowEnd: "2024-01-08T00:00:00.000Z",
    busyPeriods: [],
  },
  memory: {
    summary: undefined,
    facts: [],
    knowledge: [],
  },
};

describe("triageTasks", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns a follow-up question when no open tasks exist", async () => {
    vi.mocked(buildTaskTriageContext).mockResolvedValue(baseContext);

    const result = await triageTasks({
      userId: "user-1",
      emailAccountId: "email-1",
      logger,
    });

    expect(result.ranked).toEqual([]);
    expect(result.followUpQuestions).toEqual([
      "You have no open tasks. Want to add one?",
    ]);
    expect(result.meta).toEqual({ candidateCount: 0, openTaskCount: 0 });
    expect(vi.mocked(createGenerateObject)).not.toHaveBeenCalled();
  });

  it("throws when the email account is missing", async () => {
    vi.mocked(buildTaskTriageContext).mockResolvedValue({
      ...baseContext,
      tasks: [
        {
          id: "task-1",
          title: "Follow up",
          description: null,
          durationMinutes: 30,
          priority: "HIGH",
          energyLevel: null,
          preferredTime: null,
          dueDate: new Date("2024-01-02T00:00:00.000Z"),
          startDate: null,
          status: "OPEN",
          isAutoScheduled: false,
          scheduleLocked: false,
          scheduledStart: null,
          scheduledEnd: null,
          scheduleScore: null,
          reschedulePolicy: null,
          lastScheduled: null,
        },
      ],
    });
    vi.mocked(prisma.emailAccount.findUnique).mockResolvedValue(null);

    await expect(
      triageTasks({
        userId: "user-1",
        emailAccountId: "email-1",
        logger,
      }),
    ).rejects.toThrow("Email account not found for task triage");
  });

  it("returns LLM rankings with meta counts", async () => {
    vi.mocked(buildTaskTriageContext).mockResolvedValue({
      ...baseContext,
      tasks: [
        {
          id: "task-1",
          title: "Follow up",
          description: null,
          durationMinutes: 30,
          priority: "HIGH",
          energyLevel: null,
          preferredTime: null,
          dueDate: new Date("2024-01-02T00:00:00.000Z"),
          startDate: null,
          status: "OPEN",
          isAutoScheduled: false,
          scheduleLocked: false,
          scheduledStart: null,
          scheduledEnd: null,
          scheduleScore: null,
          reschedulePolicy: null,
          lastScheduled: null,
        },
        {
          id: "task-2",
          title: "Plan meeting",
          description: "Coordinate scheduling",
          durationMinutes: 45,
          priority: "MEDIUM",
          energyLevel: null,
          preferredTime: null,
          dueDate: null,
          startDate: null,
          status: "OPEN",
          isAutoScheduled: false,
          scheduleLocked: false,
          scheduledStart: null,
          scheduledEnd: null,
          scheduleScore: null,
          reschedulePolicy: null,
          lastScheduled: null,
        },
      ],
    });
    vi.mocked(prisma.emailAccount.findUnique).mockResolvedValue({
      id: "email-1",
      email: "user@test.com",
    });

    const generate = vi.fn().mockResolvedValue({
      object: {
        ranked: [
          {
            taskId: "task-1",
            rank: 1,
            reason: "Due soon",
            confidence: 0.8,
          },
        ],
        followUpQuestions: ["When should task-2 be due?"],
      },
    });
    vi.mocked(createGenerateObject).mockReturnValue(generate);

    const result = await triageTasks({
      userId: "user-1",
      emailAccountId: "email-1",
      logger,
    });

    expect(vi.mocked(getModel)).toHaveBeenCalledWith("chat");
    expect(result.ranked).toHaveLength(1);
    expect(result.meta).toEqual({ candidateCount: 2, openTaskCount: 2 });

    expect(generate).toHaveBeenCalled();
    const callArg = generate.mock.calls[0]?.[0] as {
      prompt?: string;
      system?: string;
    };
    expect(callArg.system).toBe("Return valid JSON only.");
    expect(callArg.prompt).toContain("Calendar busy periods (next 7 days): 0");
  });
});
