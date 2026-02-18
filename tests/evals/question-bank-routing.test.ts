import { describe, expect, it, beforeAll } from "vitest";
import fs from "node:fs";
import path from "node:path";
import type { Logger } from "@/server/lib/logger";
import { compileRuntimeTurn } from "@/server/features/ai/runtime/turn-compiler";
import { listToolDefinitions } from "@/server/features/ai/tools/runtime/capabilities/registry";

interface QuestionBankRow {
  id: string;
  question: string;
  expectedCapability: string;
}

function loadQuestionBankRows(): QuestionBankRow[] {
  const docPath = path.resolve(
    process.cwd(),
    "docs/AI_INBOX_CALENDAR_RULES_TEST_QUESTION_BANK.md",
  );
  const markdown = fs.readFileSync(docPath, "utf8");
  const rows: QuestionBankRow[] = [];

  const pattern =
    /^\d+\.\s+`([^`]+)`\s+\|\s+"([^"]+)"\s+\|\s+`([^`]+)`\s+\|/gmu;
  for (const match of markdown.matchAll(pattern)) {
    const id = match[1]?.trim();
    const question = match[2]?.trim();
    const expectedCapability = match[3]?.trim();
    if (!id || !question || !expectedCapability) continue;
    rows.push({ id, question, expectedCapability });
  }

  return rows;
}

function normalizeExpectedCapability(
  expectedCapability: string,
): string[] {
  return expectedCapability
    .split("+")
    .map((part) => part.trim())
    .map((part) => part.replace(/\(.*?\)/gu, "").trim())
    .filter((part) => part.length > 0)
    .filter(
      (part) =>
        !part.toLowerCase().includes("planner logic") &&
        !part.toLowerCase().includes("multi-action") &&
        !part.toLowerCase().includes("target-resolution") &&
        !part.toLowerCase().includes("availability logic") &&
        !part.toLowerCase().includes("policy explain path") &&
        !part.toLowerCase().includes("task/event linking flow") &&
        !part.toLowerCase().includes("event update"),
    );
}

function testLogger(): Logger {
  return {
    trace: () => {},
    info: () => {},
    warn: () => {},
    error: () => {},
    debug: () => {},
    fatal: () => {},
    child: () => testLogger(),
    with: () => testLogger(),
    flush: async () => {},
  };
}

describe("question-bank routing guardrail", () => {
  const rows = loadQuestionBankRows();

  beforeAll(() => {
    process.env.RUNTIME_TURN_COMPILER_USE_MODEL = "false";
  });

  it("has runtime tool definitions for all expected question-bank capabilities", () => {
    const knownTools = new Set(listToolDefinitions().map((def) => def.id));
    const missing: string[] = [];

    for (const row of rows) {
      const expectedTools = normalizeExpectedCapability(row.expectedCapability);
      for (const toolName of expectedTools) {
        if (!knownTools.has(toolName)) {
          missing.push(`${row.id}:${toolName}`);
        }
      }
    }

    expect(missing).toEqual([]);
  });

  it("routes every question-bank prompt into an actionable lane", async () => {
    const conversationOnly: string[] = [];
    for (const row of rows) {
      const turn = await compileRuntimeTurn({
        message: row.question,
        userId: "eval-user",
        email: "eval@example.com",
        emailAccountId: "eval-account",
        logger: testLogger(),
      });
      if (turn.routeHint === "conversation_only") {
        conversationOnly.push(row.id);
      }
    }

    expect(conversationOnly).toEqual([]);
  });
});
