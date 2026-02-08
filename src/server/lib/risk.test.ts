import { describe, expect, it } from "vitest";
import { ActionType, LogicalOperator } from "@/generated/prisma/enums";
import {
  RISK_LEVELS,
  checkRuleConditions,
  getRiskLevel,
  isFullyDynamicField,
  isPartiallyDynamicField,
} from "@/server/lib/risk";

describe("risk", () => {
  it("computes low risk for static recipient/content", () => {
    const result = getRiskLevel({
      actions: [
        {
          type: ActionType.SEND_EMAIL,
          subject: "Status update",
          content: "Hello team",
          to: "alice@example.com",
          cc: null,
          bcc: null,
        },
      ],
    });

    expect(result.level).toBe(RISK_LEVELS.LOW);
  });

  it("computes high risk for fully dynamic recipients", () => {
    const result = getRiskLevel({
      actions: [
        {
          type: ActionType.SEND_EMAIL,
          subject: "Status update",
          content: "Hello team",
          to: "{{to}}",
          cc: null,
          bcc: null,
        },
      ],
    });

    expect(result.level).toBe(RISK_LEVELS.HIGH);
  });

  it("evaluates static conditions using AND/OR operators", async () => {
    const andMatch = await checkRuleConditions(
      {
        from: "alice@example.com",
        subject: "Quarterly",
        conditionalOperator: LogicalOperator.AND,
      },
      {
        from: "Alice <alice@example.com>",
        subject: "Quarterly business review",
      },
    );

    const orMatch = await checkRuleConditions(
      {
        from: "missing@example.com",
        subject: "Quarterly",
        conditionalOperator: LogicalOperator.OR,
      },
      {
        from: "Alice <alice@example.com>",
        subject: "Quarterly business review",
      },
    );

    expect(andMatch).toBe(true);
    expect(orMatch).toBe(true);
  });

  it("classifies dynamic template fields", () => {
    expect(isFullyDynamicField("{{recipient}}")).toBe(true);
    expect(isPartiallyDynamicField("Hi {{firstName}}")).toBe(true);
  });
});
