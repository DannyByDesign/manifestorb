import { z } from "zod";
import type { ZodTypeAny } from "zod";
import type { RuntimeSession } from "@/server/features/ai/runtime/types";
import type { RuntimeTurnContext } from "@/server/features/ai/runtime/tool-runtime";
import { executeToolCall } from "@/server/features/ai/runtime/tool-runtime";
import type { RuntimeToolResult } from "@/server/features/ai/tools/contracts/tool-result";
import type { RuntimeCustomToolDefinition } from "@/server/features/ai/tools/harness/types";
import { createGenerateObject } from "@/server/lib/llms";
import { getModel } from "@/server/lib/llms/model";
import { fromZonedTime, toZonedTime } from "date-fns-tz";

function startOfDayInTimeZone(now: Date, timeZone: string): Date {
  const local = toZonedTime(now, timeZone);
  local.setHours(0, 0, 0, 0);
  return fromZonedTime(local, timeZone);
}

function endOfDayInTimeZone(now: Date, timeZone: string): Date {
  const local = toZonedTime(now, timeZone);
  local.setHours(23, 59, 59, 999);
  return fromZonedTime(local, timeZone);
}

function isClarificationLike(result: { clarification?: unknown }): boolean {
  return Boolean(result && typeof result === "object" && (result as any).clarification);
}

type RefEnv = {
  userTimeZone: string;
  nowIso: string;
  todayStartIso: string;
  todayEndIso: string;
  tomorrowStartIso: string;
  tomorrowEndIso: string;
  next7DaysEndIso: string;
};

type RefContext = {
  env: RefEnv;
  steps: Record<string, RuntimeToolResult>;
};

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function getPath(root: unknown, path: string): unknown {
  // Supports dot paths with optional [index] segments: foo.bar[0].baz
  const parts: Array<string | number> = [];
  for (const raw of path.split(".").filter(Boolean)) {
    const match = /^([^\[]+)(?:\[(\d+)\])?$/u.exec(raw);
    if (!match) return undefined;
    parts.push(match[1]);
    if (match[2] != null) parts.push(Number(match[2]));
  }

  let cur: any = root;
  for (const part of parts) {
    if (typeof part === "number") {
      if (!Array.isArray(cur)) return undefined;
      cur = cur[part];
    } else {
      if (!cur || typeof cur !== "object") return undefined;
      cur = (cur as any)[part];
    }
  }
  return cur;
}

function resolveRef(ctx: RefContext, ref: string): unknown {
  const trimmed = ref.trim();
  if (!trimmed) return undefined;
  // Allowed roots:
  // - env.<key>
  // - steps.<stepId>.<path...>
  if (trimmed.startsWith("env.")) {
    return getPath(ctx.env, trimmed.slice("env.".length));
  }
  if (trimmed.startsWith("steps.")) {
    return getPath(ctx.steps, trimmed.slice("steps.".length));
  }
  // Back-compat: "<stepId>.<path...>" resolves to steps.<stepId>.<path...>
  const firstDot = trimmed.indexOf(".");
  if (firstDot > 0) {
    const maybeStepId = trimmed.slice(0, firstDot);
    const rest = trimmed.slice(firstDot + 1);
    if (Object.prototype.hasOwnProperty.call(ctx.steps, maybeStepId)) {
      return getPath(ctx.steps[maybeStepId], rest);
    }
  }
  return undefined;
}

function resolveTemplateString(ctx: RefContext, value: string): unknown {
  const exact = /^\s*\{\{\s*([^}]+?)\s*\}\}\s*$/u.exec(value);
  if (exact) {
    return resolveRef(ctx, exact[1]);
  }

  return value.replace(/\{\{\s*([^}]+?)\s*\}\}/gu, (_m, inner) => {
    const resolved = resolveRef(ctx, String(inner));
    if (resolved == null) return "";
    if (typeof resolved === "string" || typeof resolved === "number" || typeof resolved === "boolean") {
      return String(resolved);
    }
    // Avoid embedding JSON objects into a string unless explicitly desired.
    return JSON.stringify(resolved);
  });
}

function resolveArgs(ctx: RefContext, input: unknown): unknown {
  if (typeof input === "string") return resolveTemplateString(ctx, input);
  if (Array.isArray(input)) return input.map((entry) => resolveArgs(ctx, entry));
  if (!isPlainObject(input)) return input;

  if (typeof input.$ref === "string") {
    return resolveRef(ctx, input.$ref);
  }

  const out: Record<string, unknown> = {};
  for (const [key, entry] of Object.entries(input)) {
    out[key] = resolveArgs(ctx, entry);
  }
  return out;
}

function unwrapOptional(schema: ZodTypeAny): { schema: ZodTypeAny; optional: boolean } {
  const def: any = (schema as any)?._def;
  if (!def || typeof def !== "object") return { schema, optional: false };

  // Zod v4: { type: "optional" | "default" | "nullable" | ... }
  if (def.type === "optional" || def.type === "default") {
    const inner = def.innerType as ZodTypeAny | undefined;
    if (inner) return { schema: inner, optional: true };
  }
  return { schema, optional: false };
}

function describeZodType(schema: ZodTypeAny, depth = 0): unknown {
  const def: any = (schema as any)?._def;
  if (!def || typeof def !== "object") return { type: "unknown" };

  const type = def.type;
  if (type === "string" || type === "number" || type === "boolean" || type === "date") return { type };
  if (type === "enum") {
    const entries = def.entries && typeof def.entries === "object" ? Object.keys(def.entries) : [];
    return { type: "enum", values: entries.slice(0, 24) };
  }
  if (type === "array") {
    return { type: "array", element: def.element ? describeZodType(def.element, depth + 1) : { type: "unknown" } };
  }
  if (type === "record") {
    return { type: "record" };
  }
  if (type === "object") {
    const shape = def.shape && typeof def.shape === "object" ? (def.shape as Record<string, ZodTypeAny>) : {};
    if (depth >= 1) return { type: "object", keys: Object.keys(shape).slice(0, 24) };

    const properties: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(shape)) {
      const unwrapped = unwrapOptional(value);
      properties[key] = { ...(describeZodType(unwrapped.schema, depth + 1) as any), optional: unwrapped.optional || undefined };
    }
    return { type: "object", properties };
  }
  if (type === "union") return { type: "union" };
  if (type === "literal") return { type: "literal", value: def.value };
  if (type === "nullable") return { type: "nullable" };

  return { type: String(type ?? "unknown") };
}

function describeToolForPlanner(tool: RuntimeCustomToolDefinition): unknown {
  const schema = tool.inputSchema;
  const unwrapped = unwrapOptional(schema);
  return {
    name: tool.name,
    description: tool.description,
    input: describeZodType(unwrapped.schema, 0),
  };
}

const planSchema = z
  .object({
    shouldExecute: z.boolean(),
    steps: z
      .array(
        z
          .object({
            id: z.string().min(1).max(32),
            toolName: z.string().min(1).max(96),
            args: z.record(z.string(), z.unknown()).default({}),
          })
          .strict(),
      )
      .max(10)
      .default([]),
    rationale: z.string().max(600).optional(),
  })
  .strict();

function shouldAttemptDeterministicExecution(session: RuntimeSession): boolean {
  // This executor is only called from the planner lane; keep additional gating strict to avoid
  // redundant LLM calls for simple reads.
  const turn = session.turn;
  if (turn.routeHint !== "planner") return false;
  if (turn.intent === "greeting" || turn.intent === "capabilities") return false;
  if (turn.requestedOperation === "meta") return false;
  // Favor deterministic orchestration for multi-action/mutation/cross-surface turns.
  if (turn.intent === "cross_surface_plan") return true;
  if (turn.domain === "cross_surface") return true;
  if (turn.requestedOperation === "mixed") return true;
  if (turn.requestedOperation !== "read" && turn.complexity !== "simple") return true;
  if (turn.complexity === "complex") return true;
  return false;
}

async function compileDeterministicPlan(params: {
  session: RuntimeSession;
  userTimeZone: string;
}): Promise<z.infer<typeof planSchema> | null> {
  const toolList = Array.from(params.session.toolHarness.toolLookup.values())
    .slice(0, 96)
    .map(describeToolForPlanner);

  const now = new Date();
  const todayStart = startOfDayInTimeZone(now, params.userTimeZone);
  const todayEnd = endOfDayInTimeZone(now, params.userTimeZone);
  const tomorrowStart = new Date(todayStart.getTime() + 24 * 60 * 60 * 1000);
  const tomorrowEnd = new Date(todayEnd.getTime() + 24 * 60 * 60 * 1000);
  const next7DaysEnd = new Date(todayEnd.getTime() + 7 * 24 * 60 * 60 * 1000);

  const modelOptions = getModel("economy");
  const generate = createGenerateObject({
    emailAccount: {
      id: params.session.input.emailAccountId,
      email: params.session.input.email,
      userId: params.session.input.userId,
    },
    label: "openworld-deterministic-plan-compiler",
    modelOptions,
    maxLLMRetries: 0,
  });

  try {
    const result = await generate({
      model: modelOptions.model,
      schema: planSchema,
      system: [
        "You are a planning compiler for an inbox+calendar AI assistant runtime.",
        "Return JSON only.",
        "Decide whether to emit a deterministic execution plan.",
        "If the user request is ambiguous or requires back-and-forth, set shouldExecute=false and return steps=[].",
        "If you do emit steps:",
        "- Use only tools listed in AvailableTools.",
        "- Keep it short (<= 6 steps) and sequential.",
        "- Prefer read/search tools first, then mutations.",
        "- If a mutation needs ids (threadId/eventId/etc), include an explicit prior search/get step and reference its output via $ref or {{...}}.",
        "- Do not guess ids.",
        "Reference syntax:",
        "- Structured: {\"$ref\":\"steps.<stepId>.data.<path>\"} (preferred).",
        "- Template: \"{{steps.<stepId>.data.<path>}}\" for strings.",
        "You may use env values for dates/times:",
        "- env.userTimeZone, env.nowIso, env.todayStartIso, env.todayEndIso, env.tomorrowStartIso, env.tomorrowEndIso, env.next7DaysEndIso.",
        "Never include user-visible assistant text outside of tool args (titles/subjects/bodies).",
      ].join("\n"),
      prompt: [
        `User request: ${params.session.input.message}`,
        `User timezone: ${params.userTimeZone}`,
        `Env: ${JSON.stringify({
          userTimeZone: params.userTimeZone,
          nowIso: now.toISOString(),
          todayStartIso: todayStart.toISOString(),
          todayEndIso: todayEnd.toISOString(),
          tomorrowStartIso: tomorrowStart.toISOString(),
          tomorrowEndIso: tomorrowEnd.toISOString(),
          next7DaysEndIso: next7DaysEnd.toISOString(),
        })}`,
        `AvailableTools: ${JSON.stringify(toolList)}`,
      ].join("\n"),
    });

    return planSchema.parse(result.object);
  } catch (error) {
    params.session.input.logger.warn("Deterministic plan compiler failed", { error });
    return null;
  }
}

async function runTool(
  context: RuntimeTurnContext,
  toolName: string,
  args: Record<string, unknown>,
): Promise<RuntimeToolResult> {
  return await executeToolCall({ context, decision: { toolName, args } });
}

export async function maybeRunDeterministicCrossSurfaceExecutor(params: {
  session: RuntimeSession;
  context: RuntimeTurnContext;
  userTimeZone: string;
}): Promise<{ handled: boolean }> {
  if (!shouldAttemptDeterministicExecution(params.session)) return { handled: false };

  const compiled = await compileDeterministicPlan({
    session: params.session,
    userTimeZone: params.userTimeZone,
  });
  if (!compiled || !compiled.shouldExecute || compiled.steps.length === 0) return { handled: false };

  const now = new Date();
  const todayStart = startOfDayInTimeZone(now, params.userTimeZone);
  const todayEnd = endOfDayInTimeZone(now, params.userTimeZone);
  const tomorrowStart = new Date(todayStart.getTime() + 24 * 60 * 60 * 1000);
  const tomorrowEnd = new Date(todayEnd.getTime() + 24 * 60 * 60 * 1000);
  const next7DaysEnd = new Date(todayEnd.getTime() + 7 * 24 * 60 * 60 * 1000);

  const env: RefEnv = {
    userTimeZone: params.userTimeZone,
    nowIso: now.toISOString(),
    todayStartIso: todayStart.toISOString(),
    todayEndIso: todayEnd.toISOString(),
    tomorrowStartIso: tomorrowStart.toISOString(),
    tomorrowEndIso: tomorrowEnd.toISOString(),
    next7DaysEndIso: next7DaysEnd.toISOString(),
  };

  const stepResults: Record<string, RuntimeToolResult> = {};
  let executedAny = false;

  for (const step of compiled.steps.slice(0, 10)) {
    const tool = params.session.toolHarness.toolLookup.get(step.toolName);
    if (!tool) {
      // If the plan references a tool not admitted by policy/tool filtering, fall back to native planner.
      params.session.input.logger.info("Deterministic plan referenced unavailable tool; falling back", {
        toolName: step.toolName,
        stepId: step.id,
      });
      // If we've already executed earlier steps, do not fall back into the native planner (it could
      // re-run tools and duplicate work); let the response writer handle the partial evidence.
      return { handled: executedAny };
    }

    const refCtx: RefContext = { env, steps: stepResults };
    const resolvedArgs = resolveArgs(refCtx, step.args);
    const normalizedArgs = isPlainObject(resolvedArgs) ? (resolvedArgs as Record<string, unknown>) : {};

    // Preflight args; if we haven't executed anything yet, fall back to native planner rather than
    // producing a confusing invalid-args clarification from our own deterministic lane.
    const parsed = (tool.inputSchema as ZodTypeAny).safeParse(normalizedArgs);
    if (!parsed.success) {
      params.session.input.logger.info("Deterministic plan produced invalid args; falling back", {
        toolName: step.toolName,
        stepId: step.id,
        issues: parsed.error.issues.map((issue) => issue.path.join(".")),
      });
      if (!executedAny) return { handled: false };
      return { handled: true };
    }

    const result = await runTool(params.context, step.toolName, parsed.data as Record<string, unknown>);
    executedAny = true;
    stepResults[step.id] = result;

    if (isClarificationLike(result) || result.success === false) {
      return { handled: true };
    }
  }

  return { handled: executedAny };
}

// Test helpers (pure / no network / no DB)
export const __test__ = {
  resolveArgs,
  resolveRef,
  getPath,
  shouldAttemptDeterministicExecution,
  describeZodType,
};
