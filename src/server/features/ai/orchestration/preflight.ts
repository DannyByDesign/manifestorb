import { z } from "zod";
import { createGenerateObject } from "@/server/lib/llms";
import { getModel } from "@/server/lib/llms/model";
import { createScopedLogger } from "@/server/lib/logger";
import { registerProviderSchema } from "@/server/lib/llms/schema-safety";

const logger = createScopedLogger("ai/orchestration-preflight");
const PREFLIGHT_SCHEMA_ID = "orchestration_preflight_v2";

export const orchestrationModeSchema = z.enum([
  "chat",
  "thought_partner",
  "lookup",
  "action",
]);

export const preflightDecisionSchema = z.object({
  mode: orchestrationModeSchema,
  needsTools: z.boolean(),
  needsInternalData: z.boolean(),
  contextTier: z.number().int().min(0).max(3),
  allowProactiveNudges: z.boolean(),
  confidence: z.number().min(0).max(1),
  resourceHints: z
    .array(
      z.enum([
        "email",
        "calendar",
        "task",
        "rules",
        "preferences",
        "none",
      ]),
    )
    .max(5),
});

registerProviderSchema({
  id: PREFLIGHT_SCHEMA_ID,
  owner: "ai-runtime",
  route: "preflight",
  label: "orchestration-preflight",
  schema: preflightDecisionSchema,
});

export type PreflightDecision = z.infer<typeof preflightDecisionSchema>;

export async function runOrchestrationPreflight(params: {
  message: string;
  provider: string;
  userId: string;
  emailAccount: { id: string; email: string; userId: string };
  hasPendingApproval: boolean;
  hasPendingScheduleProposal: boolean;
}): Promise<PreflightDecision> {
  const message = params.message.trim();
  if (!message) {
    return {
      mode: "chat",
      needsTools: false,
      needsInternalData: false,
      contextTier: 0,
      allowProactiveNudges: false,
      confidence: 1,
      resourceHints: ["none"],
    };
  }

  const operationalOverride = runOperationalOverride(message);
  if (operationalOverride) {
    logger.info("Preflight branch selected", {
      branch: "deterministic_operational",
      schemaId: PREFLIGHT_SCHEMA_ID,
    });
    return operationalOverride;
  }

  const fastPath = runFastPathDecision({
    message,
    hasPendingApproval: params.hasPendingApproval,
    hasPendingScheduleProposal: params.hasPendingScheduleProposal,
  });
  if (fastPath) {
    logger.info("Preflight branch selected", {
      branch:
        fastPath.needsTools
          ? "deterministic_operational"
          : "deterministic_conversational",
      schemaId: PREFLIGHT_SCHEMA_ID,
    });
    return fastPath;
  }

  const modelOptions = getModel("economy");
  const generateObject = createGenerateObject({
    emailAccount: params.emailAccount,
    label: "orchestration-preflight",
    modelOptions,
  });

  try {
    const result = await generateObject({
      model: modelOptions.model,
      schema: preflightDecisionSchema,
      prompt: `Classify this user message for orchestration.

Message: "${message}"
Provider: ${params.provider}
Pending approval exists: ${params.hasPendingApproval ? "yes" : "no"}
Pending schedule proposal exists: ${params.hasPendingScheduleProposal ? "yes" : "no"}

Rules:
- Prefer no tools for pure conversation, brainstorming, coaching, advice, or thought-partner style turns.
- Use tools only when the user asks to check/modify their real inbox/calendar/tasks/rules/preferences.
- needsInternalData=true only when response quality depends on internal state.
- contextTier:
  0 = no retrieval context
  1 = lightweight summary + short recent history
  2 = targeted retrieval for one area
  3 = broad/full retrieval for complex multi-resource work
- allowProactiveNudges=true only when user explicitly asks for status/overview/priorities/check-in.
- If uncertain, choose the lower-cost path and ask a clarifying question in plain conversation.
`,
      system:
        "Return only structured orchestration decision fields. Be conservative with tools and retrieval when the user did not ask for operational actions.",
    });

    logger.info("Preflight branch selected", {
      branch: "llm_ambiguity_resolution",
      schemaId: PREFLIGHT_SCHEMA_ID,
    });
    return result.object;
  } catch (error) {
    logger.warn("Preflight failed; falling back to conservative default", {
      error,
      provider: params.provider,
      messageLength: message.length,
    });
    return fallbackPreflight(message);
  }
}

function runOperationalOverride(message: string): PreflightDecision | null {
  const normalized = message.toLowerCase().trim();
  const hasResourceToken =
    /\b(email|emails|inbox|thread|message|messages|calendar|meeting|meetings|event|events|schedule|task|tasks|rules?|preferences?)\b/u.test(
      normalized,
    );
  const hasActionVerb =
    /\b(archive|trash|delete|cancel|reschedule|schedule|book|move|mark|set|update|modify|create|draft|reply|forward|send|unsubscribe|block|snooze|find|check|show|list)\b/u.test(
      normalized,
    );
  const hasOperationalFraming =
    /\b(can you|could you|please|help me|i need you to|i want you to)\b/u.test(normalized) ||
    /\bthat (email|thread|message|meeting|event)\b/u.test(normalized);

  if (!(hasResourceToken && hasActionVerb && hasOperationalFraming)) {
    return null;
  }

  return {
    mode: /\b(archive|trash|delete|cancel|reschedule|schedule|book|move|mark|set|update|modify|create|draft|reply|forward|send|unsubscribe|block|snooze)\b/u.test(
      normalized,
    )
      ? "action"
      : "lookup",
    needsTools: true,
    needsInternalData: true,
    contextTier: 2,
    allowProactiveNudges: false,
    confidence: 0.92,
    resourceHints: collectFastPathHints(normalized),
  };
}

function fallbackPreflight(message: string): PreflightDecision {
  const normalized = message.toLowerCase();
  const likelyOperational =
    /\b(email|emails|calendar|meeting|meetings|event|events|task|tasks|schedule|inbox|rule|rules|preferences|preference)\b/u.test(
      normalized,
    ) &&
    /\b(what|whats|what's|which|when|show|find|list|check|create|schedule|reschedule|cancel|delete|archive|mark|set|update|modify|am i|do i have)\b/u.test(
      normalized,
    );

  if (likelyOperational) {
    return {
      mode: "lookup",
      needsTools: true,
      needsInternalData: true,
      contextTier: 2,
      allowProactiveNudges: false,
      confidence: 0.55,
      resourceHints: ["email", "calendar", "task"],
    };
  }

  return {
    mode: "thought_partner",
    needsTools: false,
    needsInternalData: false,
    contextTier: 0,
    allowProactiveNudges: false,
    confidence: 0.6,
    resourceHints: ["none"],
  };
}

function runFastPathDecision({
  message,
  hasPendingApproval,
  hasPendingScheduleProposal,
}: {
  message: string;
  hasPendingApproval: boolean;
  hasPendingScheduleProposal: boolean;
}): PreflightDecision | null {
  const normalized = message.toLowerCase().trim();
  const tokenCount = normalized.split(/\s+/u).filter(Boolean).length;

  // Extremely common short social turns should stay lightweight.
  const socialShortPattern =
    /^(hi|hello|hey|yo|sup|what's up|hows it going|how are you|good (morning|afternoon|evening)|thanks|thank you|ok|okay|cool|nice)$/iu;
  if (tokenCount <= 6 && socialShortPattern.test(normalized)) {
    return {
      mode: "chat",
      needsTools: false,
      needsInternalData: false,
      contextTier: 0,
      allowProactiveNudges: false,
      confidence: 0.95,
      resourceHints: ["none"],
    };
  }

  const approvalReplyPattern =
    /^(yes|yep|yeah|approve|approved|deny|denied|no|nah|cancel|go ahead|send it|do it)$/iu;
  if ((hasPendingApproval || hasPendingScheduleProposal) && approvalReplyPattern.test(normalized)) {
    return {
      mode: "action",
      needsTools: true,
      needsInternalData: true,
      contextTier: 1,
      allowProactiveNudges: false,
      confidence: 0.9,
      resourceHints: ["none"],
    };
  }

  const hasResourceToken =
    /\b(email|emails|inbox|calendar|meeting|meetings|event|events|task|tasks|todo|rule|rules|preference|preferences)\b/u.test(
      normalized,
    );
  const hasLookupOrMutationVerb =
    /\b(what|whats|what's|which|when|show|find|list|check|search|create|schedule|reschedule|cancel|delete|trash|archive|mark|set|update|modify|send|draft|am i|do i have)\b/u.test(
      normalized,
    );

  if (hasResourceToken && hasLookupOrMutationVerb) {
    return {
      mode: /\b(create|schedule|reschedule|cancel|delete|trash|archive|mark|set|update|modify|send|draft)\b/u.test(
        normalized,
      )
        ? "action"
        : "lookup",
      needsTools: true,
      needsInternalData: true,
      contextTier: 2,
      allowProactiveNudges: false,
      confidence: 0.85,
      resourceHints: collectFastPathHints(normalized),
    };
  }

  return null;
}

function collectFastPathHints(message: string): Array<
  "email" | "calendar" | "task" | "rules" | "preferences" | "none"
> {
  const hints: Array<"email" | "calendar" | "task" | "rules" | "preferences" | "none"> = [];
  if (/\b(email|emails|inbox|thread|message|messages)\b/u.test(message)) hints.push("email");
  if (/\b(calendar|meeting|meetings|event|events|schedule)\b/u.test(message)) hints.push("calendar");
  if (/\b(task|tasks|todo|to-do)\b/u.test(message)) hints.push("task");
  if (/\b(rule|rules)\b/u.test(message)) hints.push("rules");
  if (/\b(preference|preferences|setting|settings)\b/u.test(message)) hints.push("preferences");
  return hints.length > 0 ? hints : ["none"];
}
