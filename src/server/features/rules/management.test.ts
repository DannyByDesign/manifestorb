import { beforeEach, describe, expect, it, vi } from "vitest";

const { updateManyMock, updateMock, findManyMock } = vi.hoisted(() => ({
  updateManyMock: vi.fn(),
  updateMock: vi.fn(),
  findManyMock: vi.fn(),
}));

vi.mock("@/server/db/client", () => ({
  default: {
    rule: {
      updateMany: updateManyMock,
      update: updateMock,
      findMany: findManyMock,
    },
  },
}));

import {
  enableEmailRule,
  resumePausedEmailRules,
  temporarilyDisableEmailRule,
} from "@/features/rules/management";

describe("rules management", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    updateManyMock.mockResolvedValue({ count: 0 });
    updateMock.mockResolvedValue({});
    findManyMock.mockResolvedValue([]);
  });

  it("resumes paused rules only when expiration exists and has passed", async () => {
    await resumePausedEmailRules("email-1");

    expect(updateManyMock).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          emailAccountId: "email-1",
          enabled: false,
          expiresAt: expect.objectContaining({
            not: null,
            lte: expect.any(Date),
          }),
        }),
        data: expect.objectContaining({
          enabled: true,
          isTemporary: false,
          expiresAt: null,
        }),
      }),
    );
  });

  it("marks rule temporary when disabling with expiry", async () => {
    const until = new Date("2026-02-10T00:00:00.000Z");
    await temporarilyDisableEmailRule({
      emailAccountId: "email-1",
      ruleId: "rule-1",
      until,
    });

    expect(updateMock).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "rule-1", emailAccountId: "email-1" },
        data: {
          enabled: false,
          isTemporary: true,
          expiresAt: until,
        },
      }),
    );
  });

  it("clears temporary state when re-enabling rule", async () => {
    await enableEmailRule({
      emailAccountId: "email-1",
      ruleId: "rule-1",
    });

    expect(updateMock).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "rule-1", emailAccountId: "email-1" },
        data: {
          enabled: true,
          isTemporary: false,
          expiresAt: null,
        },
      }),
    );
  });
});
