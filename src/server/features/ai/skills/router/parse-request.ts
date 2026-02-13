import { z } from "zod";
import type { Logger } from "@/server/lib/logger";
import {
  semanticRequestSchema,
  type SemanticRequest,
  type SemanticIntent,
} from "@/server/features/ai/skills/contracts/semantic-request";
import { createGenerateObject } from "@/server/lib/llms";
import { getModel } from "@/server/lib/llms/model";

const parserOutputSchema = z.object({
  intents: z.array(
    z.enum([
      "inbox_read",
      "inbox_mutate",
      "inbox_compose",
      "inbox_controls",
      "calendar_read",
      "calendar_mutate",
      "calendar_policy",
      "cross_surface_planning",
    ]),
  ),
  tasks: z.array(
    z.object({
      id: z.string(),
      intent: z.enum([
        "inbox_read",
        "inbox_mutate",
        "inbox_compose",
        "inbox_controls",
        "calendar_read",
        "calendar_mutate",
        "calendar_policy",
        "cross_surface_planning",
      ]),
      action: z.string(),
      entities: z
        .array(
          z.object({
            key: z.string(),
            value: z.union([
              z.string(),
              z.number(),
              z.boolean(),
              z.array(z.string()),
              z.record(z.string(), z.unknown()),
            ]),
            confidence: z.number().min(0).max(1),
          }),
        )
        .default([]),
      constraints: z
        .array(
          z.object({
            kind: z.string(),
            value: z.union([
              z.string(),
              z.number(),
              z.boolean(),
              z.array(z.string()),
              z.record(z.string(), z.unknown()),
            ]),
          }),
        )
        .default([]),
      confidence: z.number().min(0).max(1),
    }),
  ),
  policyHints: z.array(z.string()).default([]),
  unresolved: z.array(z.string()).default([]),
  confidence: z.number().min(0).max(1),
}).strict();

function heuristicIntents(message: string): SemanticIntent[] {
  const lower = message.toLowerCase();
  const intents = new Set<SemanticIntent>();

  if (
    /inbox|email|thread|message|sender|newsletter|unsubscribe|draft|reply|forward|archive|trash/i.test(
      lower,
    )
  ) {
    if (/draft|reply|forward|send/i.test(lower)) intents.add("inbox_compose");
    if (/archive|trash|label|spam|unsubscribe|block|mark/i.test(lower)) intents.add("inbox_mutate");
    if (/filter|rule|cleanup|newsletter|subscription/i.test(lower)) intents.add("inbox_controls");
    if (!intents.has("inbox_compose") && !intents.has("inbox_mutate")) intents.add("inbox_read");
  }

  if (
    /calendar|meeting|availability|schedule|reschedule|event|focus|out of office|working hours|booking|appointment/i.test(
      lower,
    )
  ) {
    if (/schedule|reschedule|create|cancel|delete|move|attendee/i.test(lower)) {
      intents.add("calendar_mutate");
    }
    if (/focus|working hours|out of office|booking|appointment|location/i.test(lower)) {
      intents.add("calendar_policy");
    }
    if (!intents.has("calendar_mutate") && !intents.has("calendar_policy")) {
      intents.add("calendar_read");
    }
  }

  if (intents.size > 1 || /(and|also|then|plus)/i.test(lower)) {
    intents.add("cross_surface_planning");
  }

  return [...intents];
}

export async function parseSemanticRequest(params: {
  message: string;
  logger: Logger;
  emailAccount: { id: string; email: string; userId: string };
}): Promise<SemanticRequest> {
  const raw = params.message.trim();
  const heuristic = heuristicIntents(raw);

  if (!raw) {
    return semanticRequestSchema.parse({
      intents: [],
      tasks: [],
      policyHints: [],
      unresolved: ["empty_message"],
      confidence: 0,
      raw,
    });
  }

  try {
    const modelOptions = getModel();
    const generateObject = createGenerateObject({
      emailAccount: params.emailAccount,
      label: "Skills semantic parser",
      modelOptions,
    });

    const { object } = await generateObject({
      ...modelOptions,
      schema: parserOutputSchema,
      prompt: `Parse this request into executable intent/tasks for an inbox+calendar assistant.

Rules:
- Use only provided intent enum values.
- Keep tasks concise and atomic.
- Include unresolved[] only when critical context is missing.
- Do not invent IDs.

User request:
${raw}`,
    });

    return semanticRequestSchema.parse({
      ...object,
      raw,
    });
  } catch (error) {
    params.logger.warn("[skills-semantic-parser] fallback to heuristic parse", { error });
    return semanticRequestSchema.parse({
      intents: heuristic,
      tasks: heuristic.map((intent, index) => ({
        id: `task_${index + 1}`,
        intent,
        action: raw,
        entities: [],
        constraints: [],
        confidence: 0.6,
      })),
      policyHints: [],
      unresolved: heuristic.length === 0 ? ["intent_unclear"] : [],
      confidence: heuristic.length ? 0.6 : 0.3,
      raw,
    });
  }
}
