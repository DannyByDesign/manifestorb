import { createHash } from "crypto";
import type { Logger } from "@/server/lib/logger";
import { getBaselineSkill } from "@/server/features/ai/skills/registry/baseline-registry";
import { routeSkill } from "@/server/features/ai/skills/router/route-skill";
import { resolveSlots } from "@/server/features/ai/skills/slots/resolve-slots";
import { executeSkill } from "@/server/features/ai/skills/executor/execute-skill";
import { createCapabilities } from "@/server/features/ai/capabilities";
import { emitSkillTelemetry } from "@/server/features/ai/skills/telemetry/emit";
import { resolveDefaultCalendarTimeZone } from "@/server/features/ai/tools/calendar-time";

export async function runBaselineSkillTurn(params: {
  skillsMode: "off" | "shadow" | "on";
  provider: string;
  userId: string;
  emailAccountId: string;
  email: string;
  providerName: string;
  message: string;
  logger: Logger;
  conversationId?: string;
  sourceEmailMessageId?: string;
  sourceEmailThreadId?: string;
}): Promise<
  | { kind: "clarify"; text: string }
  | { kind: "executed"; text: string; debug: { skillId: string; status: string } }
> {
  const requestId = createHash("sha256")
    .update(`${params.userId}:${params.provider}:${Date.now()}:${params.message}`)
    .digest("hex")
    .slice(0, 16);

  const tz = await resolveDefaultCalendarTimeZone({
    userId: params.userId,
    emailAccountId: params.emailAccountId,
  });
  const timeZone = "timeZone" in tz ? tz.timeZone : "UTC";

  const route = await routeSkill({
    message: params.message,
    logger: params.logger,
    emailAccount: { id: params.emailAccountId, email: params.email, userId: params.userId },
  });
  emitSkillTelemetry(params.logger, {
    name: "skill.route.completed",
    skillsMode: params.skillsMode,
    requestId,
    provider: params.provider,
    skillId: route.skillId,
    confidence: route.confidence,
    reason: route.reason,
  });

  if (!route.skillId) {
    return { kind: "clarify", text: route.clarificationPrompt ?? "What would you like to do?" };
  }

  const skill = getBaselineSkill(route.skillId);
  const slots = await resolveSlots(skill, params.message, {
    logger: params.logger,
    emailAccount: { id: params.emailAccountId, email: params.email, userId: params.userId },
    timeZone,
  });
  emitSkillTelemetry(params.logger, {
    name: "skill.slot_resolution.completed",
    skillsMode: params.skillsMode,
    requestId,
    provider: params.provider,
    skillId: route.skillId,
    missingRequired: slots.missingRequired.length,
    ambiguous: slots.ambiguous.length,
  });

  if (slots.missingRequired.length > 0) {
    return {
      kind: "clarify",
      text: slots.clarificationPrompt ?? "I need one more detail to continue.",
    };
  }

  const capabilities = await createCapabilities({
    userId: params.userId,
    emailAccountId: params.emailAccountId,
    email: params.email,
    provider: params.providerName,
    logger: params.logger,
    conversationId: params.conversationId,
    currentMessage: params.message,
    sourceEmailMessageId: params.sourceEmailMessageId,
    sourceEmailThreadId: params.sourceEmailThreadId,
  });

  const result = await executeSkill({ skill, slots, capabilities });
  emitSkillTelemetry(params.logger, {
    name: "skill.execution.completed",
    skillsMode: params.skillsMode,
    requestId,
    provider: params.provider,
    skillId: route.skillId,
    status: result.status,
    stepsExecuted: result.stepsExecuted,
    toolChain: result.toolChain,
    postconditionsPassed: result.postconditionsPassed,
    ...(result.failureReason ? { failureReason: result.failureReason } : {}),
  });

  return {
    kind: "executed",
    text: result.responseText,
    debug: { skillId: route.skillId, status: result.status },
  };
}
