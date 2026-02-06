import { describe, expect, it } from "vitest";
import { parseScheduleProposalChoice } from "@/server/features/calendar/schedule-proposal";

describe("schedule proposal choice parsing", () => {
  it("handles ordinal choices", () => {
    expect(parseScheduleProposalChoice("first works", 3)).toBe(0);
    expect(parseScheduleProposalChoice("last", 3)).toBe(2);
  });

  it("handles numeric choices", () => {
    expect(parseScheduleProposalChoice("2", 3)).toBe(1);
  });

  it("returns null for invalid choice", () => {
    expect(parseScheduleProposalChoice("fourth option", 3)).toBeNull();
  });
});
