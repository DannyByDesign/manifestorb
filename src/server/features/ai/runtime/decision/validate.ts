import type { RuntimeSession } from "@/server/features/ai/runtime/types";
import type {
  RuntimeDecision,
  ValidatedToolDecision,
} from "@/server/features/ai/runtime/decision/schema";

function parseArgsJson(argsJson: string):
  | { ok: true; value: Record<string, unknown> }
  | { ok: false; reason: string } {
  try {
    const parsed = JSON.parse(argsJson);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return { ok: false, reason: "args_json_not_object" };
    }
    return { ok: true, value: parsed as Record<string, unknown> };
  } catch {
    return { ok: false, reason: "args_json_invalid" };
  }
}

function firstZodIssueMessage(error: unknown): string {
  const issues = (error as { issues?: Array<{ path?: Array<string | number>; message?: string }> })
    ?.issues;
  if (!issues || issues.length === 0) return "schema_validation_failed";
  const issue = issues[0]!;
  const path = Array.isArray(issue.path) && issue.path.length > 0 ? issue.path.join(".") : "$";
  const message = typeof issue.message === "string" ? issue.message : "invalid";
  return `${path}:${message}`;
}

export type RuntimeDecisionValidationResult =
  | {
      ok: true;
      decision:
        | RuntimeDecision
        | ValidatedToolDecision;
    }
  | {
      ok: false;
      reason: string;
      toolName?: string;
      argsJson?: string;
    };

export function validateRuntimeDecision(params: {
  decision: RuntimeDecision;
  session: RuntimeSession;
}): RuntimeDecisionValidationResult {
  const { decision, session } = params;

  if (decision.type !== "tool_call") {
    if (!decision.responseText || decision.responseText.trim().length === 0) {
      return {
        ok: false,
        reason: "missing_response_text",
      };
    }
    return { ok: true, decision };
  }

  const toolName = decision.toolName?.trim();
  if (!toolName) {
    return {
      ok: false,
      reason: "missing_tool_name",
      argsJson: decision.argsJson,
    };
  }

  const tool = session.toolLookup.get(toolName);
  if (!tool) {
    return {
      ok: false,
      reason: "unknown_tool",
      toolName,
      argsJson: decision.argsJson,
    };
  }

  if (!decision.argsJson || decision.argsJson.trim().length === 0) {
    return {
      ok: false,
      reason: "missing_args_json",
      toolName,
    };
  }

  const parsed = parseArgsJson(decision.argsJson);
  if (!parsed.ok) {
    return {
      ok: false,
      reason: parsed.reason,
      toolName,
      argsJson: decision.argsJson,
    };
  }

  const validation = tool.parameters.safeParse(parsed.value);
  if (!validation.success) {
    return {
      ok: false,
      reason: firstZodIssueMessage(validation.error),
      toolName,
      argsJson: decision.argsJson,
    };
  }

  return {
    ok: true,
    decision: {
      type: "tool_call",
      toolName,
      args: parsed.value,
      rationale: decision.rationale,
    },
  };
}
