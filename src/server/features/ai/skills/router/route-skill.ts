import { z } from "zod";
import type { Logger } from "@/server/lib/logger";
import type { SkillId } from "@/server/features/ai/skills/baseline/skill-ids";
import { BASELINE_SKILL_IDS } from "@/server/features/ai/skills/baseline/skill-ids";
import { baselineSkills } from "@/server/features/ai/skills/baseline";
import { createGenerateObject } from "@/server/lib/llms";
import { getModel } from "@/server/lib/llms/model";
import { buildBaselineRouterPrompt, buildBaselineSkillMenu } from "@/server/features/ai/skills/router/router-prompts";

export interface SkillRouteResult {
  skillId: SkillId | null;
  confidence: number;
  reason: string;
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
  { skillId: "calendar_find_availability", confidence: 0.9, patterns: [/availability/i, /when are .* free/i, /find time/i] },
  { skillId: "calendar_schedule_from_context", confidence: 0.88, patterns: [/schedule (a )?(meeting|event|call)/i, /book .*calendar/i] },
  { skillId: "calendar_reschedule_with_constraints", confidence: 0.9, patterns: [/reschedule/i, /move this event/i, /new time/i] },
  { skillId: "calendar_focus_time_defense", confidence: 0.88, patterns: [/focus time/i, /deep work/i, /block time/i] },
  { skillId: "calendar_working_hours_ooo", confidence: 0.9, patterns: [/working hours?/i, /out of office/i, /ooo/i] },
  { skillId: "calendar_booking_page_setup", confidence: 0.86, patterns: [/booking page/i, /appointment schedule/i, /booking slots/i] },
  { skillId: "calendar_meeting_load_rebalance", confidence: 0.84, patterns: [/meeting load/i, /rebalance/i, /too many meetings/i] },
  { skillId: "daily_plan_inbox_calendar", confidence: 0.84, patterns: [/plan my day/i, /daily plan/i, /today's plan/i] },
];

const MIN_CONFIDENCE = 0.72;

function routeSkillDeterministic(message: string): SkillRouteResult {
  const normalized = message.trim();
  if (!normalized) {
    return {
      skillId: null,
      confidence: 0,
      reason: "empty_message",
      clarificationPrompt: "What would you like help with in your inbox or calendar?",
    };
  }

  let best: SkillRouteResult = {
    skillId: null,
    confidence: 0,
    reason: "no_match",
  };

  for (const rule of routeRules) {
    const matches = rule.patterns.filter((p) => p.test(normalized)).length;
    if (matches === 0) continue;
    const confidence = Math.min(0.99, rule.confidence + matches * 0.02);
    if (confidence > best.confidence) {
      best = {
        skillId: rule.skillId,
        confidence,
        reason: `rule_match:${matches}`,
      };
    }
  }

  if (!best.skillId || best.confidence < MIN_CONFIDENCE) {
    return {
      skillId: null,
      confidence: best.confidence,
      reason: best.reason,
      clarificationPrompt:
        "I can help with inbox cleanup, drafting, follow-ups, scheduling, and calendar planning. Which one do you want?",
    };
  }

  if (!(BASELINE_SKILL_IDS as readonly string[]).includes(best.skillId)) {
    return {
      skillId: null,
      confidence: 0,
      reason: "invalid_skill_output",
      clarificationPrompt: "I couldn't safely route that request. Please rephrase your inbox or calendar goal.",
    };
  }

  return best;
}

export async function routeSkill(params: {
  message: string;
  logger: Logger;
  emailAccount: { id: string; email: string; userId: string };
}): Promise<SkillRouteResult> {
  const normalized = params.message.trim();
  if (!normalized) return routeSkillDeterministic(params.message);

  // Fast-path heuristic: if deterministic routing is already high confidence, take it.
  const heuristic = routeSkillDeterministic(params.message);
  if (heuristic.skillId && heuristic.confidence >= 0.9) return heuristic;

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
      return {
        skillId: null,
        confidence: candidate.confidence,
        reason: `llm:${candidate.reason}`,
        clarificationPrompt:
          candidate.clarificationPrompt ??
          "I can help with inbox cleanup, drafting, follow-ups, scheduling, and calendar planning. What do you want to do?",
      };
    }

    return {
      skillId: candidate.skillId,
      confidence: candidate.confidence,
      reason: `llm:${candidate.reason}`,
      ...(candidate.clarificationPrompt ? { clarificationPrompt: candidate.clarificationPrompt } : {}),
    };
  } catch (error) {
    params.logger.warn("[skills-router] LLM route failed; falling back to heuristic", { error });
    return heuristic;
  }
}
