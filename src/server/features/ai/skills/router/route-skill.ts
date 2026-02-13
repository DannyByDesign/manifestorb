import { z } from "zod";
import type { Logger } from "@/server/lib/logger";
import type { SkillId } from "@/server/features/ai/skills/baseline/skill-ids";
import { BASELINE_SKILL_IDS } from "@/server/features/ai/skills/baseline/skill-ids";
import { baselineSkills } from "@/server/features/ai/skills/baseline";
import { createGenerateObject } from "@/server/lib/llms";
import { getModel } from "@/server/lib/llms/model";
import { buildBaselineRouterPrompt, buildBaselineSkillMenu } from "@/server/features/ai/skills/router/router-prompts";
import { parseSemanticRequest } from "@/server/features/ai/skills/router/parse-request";
import { routeIntentFamilies } from "@/server/features/ai/skills/router/route-intent-family";

export interface SkillRouteResult {
  routeType: "skill" | "planner" | "clarify";
  skillId: SkillId | null;
  confidence: number;
  reason: string;
  semanticParseConfidence: number;
  routedFamilies: string[];
  unresolvedEntities: string[];
  clarificationPrompt?: string;
}

const skillEnum = z.enum([...BASELINE_SKILL_IDS] as [SkillId, ...SkillId[]]);

const llmRouteSchema = z.object({
  skillId: skillEnum.nullable(),
  confidence: z.number().min(0).max(1),
  reason: z.string().min(1),
  clarificationPrompt: z.string().optional(),
}).strict();

const routeRules: Array<{ skillId: SkillId; confidence: number; patterns: RegExp[] }> = [
  { skillId: "inbox_bulk_newsletter_cleanup", confidence: 0.9, patterns: [/newsletter/i, /promotions?/i, /bulk clean/i, /cleanup/i] },
  { skillId: "inbox_subscription_control", confidence: 0.9, patterns: [/unsubscribe/i, /block sender/i, /stop these emails/i] },
  { skillId: "inbox_snooze_or_defer", confidence: 0.88, patterns: [/snooze/i, /defer/i, /remind me later/i] },
  { skillId: "inbox_draft_reply", confidence: 0.88, patterns: [/draft/i, /compose/i, /write.*reply/i] },
  { skillId: "inbox_schedule_send", confidence: 0.82, patterns: [/schedule send/i, /send (tomorrow|later|next)/i] },
  { skillId: "inbox_followup_guard", confidence: 0.86, patterns: [/follow ?up/i, /awaiting reply/i, /who hasn't replied/i] },
  { skillId: "inbox_thread_summarize_actions", confidence: 0.88, patterns: [/summari[sz]e/i, /action items?/i, /decisions?/i] },
  { skillId: "inbox_triage_today", confidence: 0.82, patterns: [/triage/i, /prioriti[sz]e.*inbox/i, /what should i reply/i] },
  { skillId: "inbox_mark_read_unread", confidence: 0.88, patterns: [/mark .* as read/i, /mark .* unread/i, /read state/i] },
  { skillId: "inbox_label_management", confidence: 0.86, patterns: [/label/i, /remove label/i, /tag these/i] },
  { skillId: "inbox_move_or_spam_control", confidence: 0.86, patterns: [/move .* folder/i, /mark .* spam/i, /junk/i] },
  { skillId: "inbox_reply_or_forward_send", confidence: 0.9, patterns: [/reply .* send/i, /forward .* send/i, /send now/i] },
  { skillId: "inbox_filter_management", confidence: 0.88, patterns: [/create filter/i, /delete filter/i, /manage filters/i] },
  { skillId: "calendar_find_availability", confidence: 0.9, patterns: [/availability/i, /when are .* free/i, /find time/i] },
  { skillId: "calendar_schedule_from_context", confidence: 0.88, patterns: [/schedule (a )?(meeting|event|call)/i, /book .*calendar/i] },
  { skillId: "calendar_reschedule_with_constraints", confidence: 0.9, patterns: [/reschedule/i, /move this event/i, /new time/i] },
  { skillId: "calendar_event_delete_or_cancel", confidence: 0.9, patterns: [/cancel .*meeting/i, /delete .*event/i, /remove .*calendar/i] },
  { skillId: "calendar_attendee_management", confidence: 0.88, patterns: [/add attendees/i, /remove attendees/i, /update participants/i] },
  { skillId: "calendar_recurring_series_management", confidence: 0.88, patterns: [/recurring/i, /series/i, /this instance|whole series/i] },
  { skillId: "calendar_working_location_management", confidence: 0.88, patterns: [/working location/i, /remote today/i, /office location/i] },
  { skillId: "calendar_focus_time_defense", confidence: 0.88, patterns: [/focus time/i, /deep work/i, /block time/i] },
  { skillId: "calendar_working_hours_ooo", confidence: 0.9, patterns: [/working hours?/i, /out of office/i, /ooo/i] },
  { skillId: "calendar_booking_page_setup", confidence: 0.86, patterns: [/booking page/i, /appointment schedule/i, /booking slots/i] },
  { skillId: "calendar_meeting_load_rebalance", confidence: 0.84, patterns: [/meeting load/i, /rebalance/i, /too many meetings/i] },
  { skillId: "rule_plane_management", confidence: 0.9, patterns: [/rule plane/i, /\bguardrail\b/i, /\bautomation rule\b/i, /\bpreference rule\b/i, /\bpolicy rule\b/i, /\brule id\b/i] },
  { skillId: "daily_plan_inbox_calendar", confidence: 0.84, patterns: [/plan my day/i, /daily plan/i, /today's plan/i] },
  { skillId: "multi_action_inbox_calendar", confidence: 0.82, patterns: [/ and /i, /also/i, /then /i, /plus /i] },
];

const MIN_CONFIDENCE = 0.72;

function buildClarifyResult(params: {
  confidence: number;
  reason: string;
  semanticParseConfidence?: number;
  routedFamilies?: string[];
  unresolvedEntities?: string[];
  clarificationPrompt: string;
}): SkillRouteResult {
  return {
    routeType: "clarify",
    skillId: null,
    confidence: params.confidence,
    reason: params.reason,
    semanticParseConfidence: params.semanticParseConfidence ?? 0,
    routedFamilies: params.routedFamilies ?? [],
    unresolvedEntities: params.unresolvedEntities ?? [],
    clarificationPrompt: params.clarificationPrompt,
  };
}

function shouldUsePlannerFallbackFromHeuristic(message: string): boolean {
  return /\b(email|inbox|calendar|meeting|event|schedule|reschedule|draft|reply|forward|archive|trash|label|unsubscribe|block|availability|focus|working hours|out of office|booking|rule|policy|guardrail|automation)\b/i.test(
    message,
  );
}

function shouldUsePlannerFallbackFromSemantic(params: {
  message: string;
  semanticConfidence: number;
  routedFamilies: string[];
  unresolvedEntities: string[];
}): boolean {
  if (params.unresolvedEntities.includes("empty_message")) {
    return false;
  }
  const hasActionLanguage = /\b(find|show|summari[sz]e|draft|reply|forward|send|archive|trash|delete|move|label|unsubscribe|block|mark|schedule|reschedule|cancel|create|update|set|plan|rebalance)\b/i.test(
    params.message,
  );
  if (params.routedFamilies.length > 0) {
    return true;
  }
  if (hasActionLanguage && params.semanticConfidence >= 0.4) {
    return true;
  }
  return false;
}

function routeSkillDeterministic(message: string): SkillRouteResult {
  const normalized = message.trim();
  if (!normalized) {
    return buildClarifyResult({
      confidence: 0,
      reason: "empty_message",
      clarificationPrompt: "What would you like help with in your inbox or calendar?",
      unresolvedEntities: ["empty_message"],
    });
  }

  let best: SkillRouteResult = {
    routeType: "clarify",
    skillId: null,
    confidence: 0,
    reason: "no_match",
    semanticParseConfidence: 0,
    routedFamilies: [],
    unresolvedEntities: [],
  };

  for (const rule of routeRules) {
    const matches = rule.patterns.filter((p) => p.test(normalized)).length;
    if (matches === 0) continue;
    const confidence = Math.min(0.99, rule.confidence + matches * 0.02);
    if (confidence > best.confidence) {
      best = {
        routeType: "skill",
        skillId: rule.skillId,
        confidence,
        reason: `rule_match:${matches}`,
        semanticParseConfidence: confidence,
        routedFamilies: [],
        unresolvedEntities: [],
      };
    }
  }

  if (!best.skillId || best.confidence < MIN_CONFIDENCE) {
    if (shouldUsePlannerFallbackFromHeuristic(normalized)) {
      return {
        routeType: "planner",
        skillId: null,
        confidence: Math.max(best.confidence, 0.62),
        reason: "heuristic_planner_fallback",
        semanticParseConfidence: best.semanticParseConfidence,
        routedFamilies: best.routedFamilies,
        unresolvedEntities: best.unresolvedEntities,
      };
    }

    return buildClarifyResult({
      confidence: best.confidence,
      reason: best.reason,
      semanticParseConfidence: best.semanticParseConfidence,
      routedFamilies: best.routedFamilies,
      unresolvedEntities: best.unresolvedEntities,
      clarificationPrompt:
        "I can help with inbox cleanup, drafting, follow-ups, scheduling, and calendar planning. Which one do you want?",
    });
  }

  if (!(BASELINE_SKILL_IDS as readonly string[]).includes(best.skillId)) {
    return buildClarifyResult({
      confidence: 0,
      reason: "invalid_skill_output",
      clarificationPrompt: "I couldn't safely route that request. Please rephrase your inbox or calendar goal.",
    });
  }

  return {
    ...best,
    routeType: "skill",
  };
}

export async function routeSkill(params: {
  message: string;
  logger: Logger;
  emailAccount: { id: string; email: string; userId: string };
}): Promise<SkillRouteResult> {
  const normalized = params.message.trim();
  if (!normalized) return routeSkillDeterministic(params.message);

  const semantic = await parseSemanticRequest({
    message: normalized,
    logger: params.logger,
    emailAccount: params.emailAccount,
  });
  const intentFamilies = routeIntentFamilies({
    intents: semantic.intents,
    confidence: semantic.confidence,
  });

  if (
    intentFamilies.isMultiIntent &&
    intentFamilies.families.includes("cross_surface_planning")
  ) {
    return {
      routeType: "skill",
      skillId: "multi_action_inbox_calendar",
      confidence: Math.max(intentFamilies.confidence, 0.74),
      reason: "semantic:cross_surface_planning",
      semanticParseConfidence: semantic.confidence,
      routedFamilies: intentFamilies.families,
      unresolvedEntities: semantic.unresolved,
    };
  }

  try {
    const modelOptions = getModel();
    const generateObject = createGenerateObject({
      emailAccount: params.emailAccount,
      label: "Skills router (baseline closed set)",
      modelOptions,
    });

    const skillMenu = buildBaselineSkillMenu(baselineSkills);

    const { object } = await generateObject({
      ...modelOptions,
      schema: llmRouteSchema,
      prompt: buildBaselineRouterPrompt({ message: normalized, skillMenu }),
    });

    const candidate = object;
    if (!candidate.skillId || candidate.confidence < MIN_CONFIDENCE) {
      if (
        shouldUsePlannerFallbackFromSemantic({
          message: normalized,
          semanticConfidence: semantic.confidence,
          routedFamilies: intentFamilies.families,
          unresolvedEntities: semantic.unresolved,
        })
      ) {
        return {
          routeType: "planner",
          skillId: null,
          confidence: Math.max(candidate.confidence, Math.min(semantic.confidence, 0.82)),
          reason: `planner_fallback:${candidate.reason}`,
          semanticParseConfidence: semantic.confidence,
          routedFamilies: intentFamilies.families,
          unresolvedEntities: semantic.unresolved,
          clarificationPrompt: candidate.clarificationPrompt,
        };
      }

      return buildClarifyResult({
        confidence: candidate.confidence,
        reason: `llm:${candidate.reason}`,
        semanticParseConfidence: semantic.confidence,
        routedFamilies: intentFamilies.families,
        unresolvedEntities: semantic.unresolved,
        clarificationPrompt:
          candidate.clarificationPrompt ??
          "I can help with inbox cleanup, drafting, follow-ups, scheduling, and calendar planning. What do you want to do?",
      });
    }

    return {
      routeType: "skill",
      skillId: candidate.skillId,
      confidence: candidate.confidence,
      reason: `llm:${candidate.reason}`,
      semanticParseConfidence: semantic.confidence,
      routedFamilies: intentFamilies.families,
      unresolvedEntities: semantic.unresolved,
      ...(candidate.clarificationPrompt ? { clarificationPrompt: candidate.clarificationPrompt } : {}),
    };
  } catch (error) {
    params.logger.warn("[skills-router] LLM route failed; falling back to heuristic", { error });
    const heuristic = routeSkillDeterministic(params.message);
    if (heuristic.routeType === "clarify") {
      if (
        shouldUsePlannerFallbackFromSemantic({
          message: normalized,
          semanticConfidence: semantic.confidence,
          routedFamilies: intentFamilies.families,
          unresolvedEntities: semantic.unresolved,
        })
      ) {
        return {
          routeType: "planner",
          skillId: null,
          confidence: Math.max(heuristic.confidence, Math.min(semantic.confidence, 0.8)),
          reason: `planner_fallback:${heuristic.reason}`,
          semanticParseConfidence: semantic.confidence,
          routedFamilies: intentFamilies.families,
          unresolvedEntities: semantic.unresolved,
          clarificationPrompt: heuristic.clarificationPrompt,
        };
      }
      return {
        ...heuristic,
        semanticParseConfidence: semantic.confidence,
        routedFamilies: intentFamilies.families,
        unresolvedEntities: semantic.unresolved,
      };
    }

    return {
      ...heuristic,
      semanticParseConfidence: semantic.confidence,
      routedFamilies: intentFamilies.families,
      unresolvedEntities: semantic.unresolved,
    };
  }
}
