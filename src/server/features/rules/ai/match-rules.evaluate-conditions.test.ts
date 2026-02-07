import { describe, it, expect, vi } from "vitest";
import { evaluateRuleConditions } from "./match-rules";
import { LogicalOperator } from "@/generated/prisma/enums";
import { ConditionType } from "@/server/lib/config";
import {
  logger,
  getRule,
  getHeaders,
  getMessage,
} from "./match-rules.test-helpers";

vi.mock("server-only", () => ({}));
vi.mock("@/server/db/client");
vi.mock("@/features/rules/ai/ai-choose-rule", () => ({ aiChooseRule: vi.fn() }));
vi.mock("@/features/reply-tracker/check-sender-reply-history", () => ({
  checkSenderReplyHistory: vi.fn(),
}));
vi.mock("@/features/cold-email/cold-email-rule", () => ({
  getColdEmailRule: vi.fn(),
  isColdEmailRuleEnabled: vi.fn(),
}));
vi.mock("@/features/cold-email/is-cold-email", () => ({ isColdEmail: vi.fn() }));

describe("evaluateRuleConditions", () => {
  it("should match STATIC condition", () => {
    const rule = getRule({ from: "test@example.com" });
    const message = getMessage({
      headers: getHeaders({ from: "test@example.com" }),
    });

    const result = evaluateRuleConditions({ rule, message, logger });

    expect(result.matched).toBe(true);
    expect(result.potentialAiMatch).toBe(false);
    expect(result.matchReasons).toEqual([{ type: ConditionType.STATIC }]);
  });

  it("should not match when STATIC condition fails", () => {
    const rule = getRule({ from: "test@example.com" });
    const message = getMessage({
      headers: getHeaders({ from: "other@example.com" }),
    });

    const result = evaluateRuleConditions({ rule, message, logger });

    expect(result.matched).toBe(false);
    expect(result.potentialAiMatch).toBe(false);
    expect(result.matchReasons).toEqual([]);
  });

  it("should return potentialAiMatch for AI-only rule", () => {
    const rule = getRule({
      instructions: "Some AI instructions",
      from: null,
      to: null,
      subject: null,
      body: null,
    });
    const message = getMessage();

    const result = evaluateRuleConditions({ rule, message, logger });

    expect(result.matched).toBe(false);
    expect(result.potentialAiMatch).toBe(true);
    expect(result.matchReasons).toEqual([]);
  });

  it("OR: when STATIC matches and rule has AI condition, require AI confirmation", () => {
    const rule = getRule({
      conditionalOperator: LogicalOperator.OR,
      from: "test@example.com",
      instructions: "Some AI instructions",
    });
    const message = getMessage({
      headers: getHeaders({ from: "test@example.com" }),
    });

    const result = evaluateRuleConditions({ rule, message, logger });

    expect(result.matched).toBe(false);
    expect(result.potentialAiMatch).toBe(true);
    expect(result.matchReasons).toEqual([{ type: ConditionType.STATIC }]);
  });

  it("OR: should return potentialAiMatch when STATIC fails but has AI", () => {
    const rule = getRule({
      conditionalOperator: LogicalOperator.OR,
      from: "test@example.com",
      instructions: "Some AI instructions",
    });
    const message = getMessage({
      headers: getHeaders({ from: "other@example.com" }),
    });

    const result = evaluateRuleConditions({ rule, message, logger });

    expect(result.matched).toBe(false);
    expect(result.potentialAiMatch).toBe(true);
    expect(result.matchReasons).toEqual([]);
  });

  it("AND: should return potentialAiMatch when STATIC passes and has AI", () => {
    const rule = getRule({
      conditionalOperator: LogicalOperator.AND,
      from: "test@example.com",
      instructions: "Some AI instructions",
    });
    const message = getMessage({
      headers: getHeaders({ from: "test@example.com" }),
    });

    const result = evaluateRuleConditions({ rule, message, logger });

    expect(result.matched).toBe(false);
    expect(result.potentialAiMatch).toBe(true);
    expect(result.matchReasons).toEqual([{ type: ConditionType.STATIC }]);
  });

  it("AND: should not match when STATIC fails even with AI", () => {
    const rule = getRule({
      conditionalOperator: LogicalOperator.AND,
      from: "test@example.com",
      instructions: "Some AI instructions",
    });
    const message = getMessage({
      headers: getHeaders({ from: "other@example.com" }),
    });

    const result = evaluateRuleConditions({ rule, message, logger });

    expect(result.matched).toBe(false);
    expect(result.potentialAiMatch).toBe(false);
    expect(result.matchReasons).toEqual([]);
  });

  it("should NOT match when no conditions are present", () => {
    const rule = getRule({
      from: null,
      to: null,
      subject: null,
      body: null,
      instructions: null,
    });
    const message = getMessage();

    const result = evaluateRuleConditions({ rule, message, logger });

    expect(result.matched).toBe(false);
    expect(result.potentialAiMatch).toBe(false);
    expect(result.matchReasons).toEqual([]);
  });

  it("OR: should not match when STATIC fails and no AI condition", () => {
    const rule = getRule({
      conditionalOperator: LogicalOperator.OR,
      from: "test@example.com",
      instructions: null,
    });
    const message = getMessage({
      headers: getHeaders({ from: "other@example.com" }),
    });

    const result = evaluateRuleConditions({ rule, message, logger });

    expect(result.matched).toBe(false);
    expect(result.potentialAiMatch).toBe(false);
    expect(result.matchReasons).toEqual([]);
  });
});
