import { z } from "zod";
import prisma from "@/server/db/client";
import {
  calculateNextScheduleDate,
  createCanonicalTimeOfDay,
} from "@/server/lib/schedule";
import type { Logger } from "@/server/lib/logger";

const frequencySchema = z.enum(["NEVER", "DAILY", "WEEKLY"]);

const toolPolicySchema = z
  .object({
    allow: z.array(z.string().min(1)).optional(),
    alsoAllow: z.array(z.string().min(1)).optional(),
    deny: z.array(z.string().min(1)).optional(),
  })
  .strict()
  .superRefine((value, ctx) => {
    if (value.allow && value.allow.length > 0 && value.alsoAllow && value.alsoAllow.length > 0) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message:
          "tools policy cannot set both allow and alsoAllow in the same scope (merge alsoAllow into allow, or remove allow and use profile + alsoAllow)",
      });
    }
  });

const toolPolicyWithProfileSchema = toolPolicySchema.extend({
  profile: z.string().min(1).optional(),
});

const policyMapSchema = z.record(z.string().min(1), toolPolicyWithProfileSchema);

const taskPreferencePatchSchema = z
  .object({
    weekStartDay: z.enum(["SUNDAY", "MONDAY"]).optional(),
    workHourStart: z.number().int().min(0).max(23).optional(),
    workHourEnd: z.number().int().min(1).max(24).optional(),
    workDays: z.array(z.number().int().min(0).max(6)).max(7).optional(),
    bufferMinutes: z.number().int().min(0).max(240).optional(),
    selectedCalendarIds: z.array(z.string().min(1)).max(64).optional(),
    timeZone: z.string().min(1).max(100).optional(),
    groupByProject: z.boolean().optional(),
    defaultMeetingDurationMin: z.number().int().min(5).max(480).optional(),
    meetingSlotCount: z.number().int().min(1).max(20).optional(),
    meetingExpirySeconds: z.number().int().min(60).max(60 * 60 * 24 * 30).optional(),
  })
  .strict();

const aiConfigPatchSchema = z
  .object({
    maxSteps: z.number().int().min(1).max(200).optional(),
    approvalInstructions: z.string().min(1).max(4000).optional(),
    customInstructions: z.string().min(1).max(8000).optional(),
    conversationCategories: z.array(z.string().min(1).max(100)).max(64).optional(),
    defaultApprovalExpirySeconds: z.number().int().min(60).max(60 * 60 * 24 * 30).optional(),
    toolProfile: z.string().min(1).optional(),
    toolAllow: z.array(z.string().min(1)).max(256).optional(),
    toolAlsoAllow: z.array(z.string().min(1)).max(256).optional(),
    toolDeny: z.array(z.string().min(1)).max(256).optional(),
    toolByProvider: policyMapSchema.optional(),
    toolByAgent: z
      .record(
        z.string().min(1),
        z.union([
          toolPolicyWithProfileSchema,
          z
            .object({
              tools: toolPolicyWithProfileSchema.optional(),
              byProvider: policyMapSchema.optional(),
            })
            .strict(),
        ]),
      )
      .optional(),
    toolByGroup: policyMapSchema.optional(),
    toolSandboxPolicy: toolPolicySchema.optional(),
    toolSubagentPolicy: toolPolicySchema.optional(),
  })
  .superRefine((value, ctx) => {
    if (
      value.toolAllow &&
      value.toolAllow.length > 0 &&
      value.toolAlsoAllow &&
      value.toolAlsoAllow.length > 0
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message:
          "toolAllow and toolAlsoAllow cannot both be set in the same scope; merge toolAlsoAllow into toolAllow or remove toolAllow and use toolProfile + toolAlsoAllow",
      });
    }
  })
  .strict();

const digestScheduleSchema = z
  .object({
    intervalDays: z.number().int().min(1).max(365).nullable(),
    daysOfWeek: z.number().int().min(0).max(127).nullable(),
    timeOfDay: z.date().nullable(),
    occurrences: z.number().int().min(1).max(64).nullable(),
  })
  .strict();

type TaskPreferencePatch = z.infer<typeof taskPreferencePatchSchema>;
type AiConfigPatch = z.infer<typeof aiConfigPatchSchema>;

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function omitUndefined<T extends Record<string, unknown>>(input: T): Partial<T> {
  const next = Object.entries(input).filter(([, value]) => value !== undefined);
  return Object.fromEntries(next) as Partial<T>;
}

function pickKnownTaskPreferenceKeys(payload: Record<string, unknown>): TaskPreferencePatch {
  const weekStartDay =
    payload.weekStartDay === "SUNDAY" || payload.weekStartDay === "MONDAY"
      ? payload.weekStartDay
      : payload.weekStartDay === "sunday"
        ? "SUNDAY"
        : payload.weekStartDay === "monday"
          ? "MONDAY"
          : undefined;

  return omitUndefined({
    weekStartDay,
    workHourStart:
      typeof payload.workHourStart === "number" ? payload.workHourStart : undefined,
    workHourEnd: typeof payload.workHourEnd === "number" ? payload.workHourEnd : undefined,
    workDays: Array.isArray(payload.workDays) ? payload.workDays : undefined,
    bufferMinutes:
      typeof payload.bufferMinutes === "number" ? payload.bufferMinutes : undefined,
    selectedCalendarIds: Array.isArray(payload.selectedCalendarIds)
      ? payload.selectedCalendarIds
      : undefined,
    timeZone: typeof payload.timeZone === "string" ? payload.timeZone : undefined,
    groupByProject:
      typeof payload.groupByProject === "boolean" ? payload.groupByProject : undefined,
    defaultMeetingDurationMin:
      typeof payload.defaultMeetingDurationMin === "number"
        ? payload.defaultMeetingDurationMin
        : undefined,
    meetingSlotCount:
      typeof payload.meetingSlotCount === "number" ? payload.meetingSlotCount : undefined,
    meetingExpirySeconds:
      typeof payload.meetingExpirySeconds === "number"
        ? payload.meetingExpirySeconds
        : undefined,
  }) as TaskPreferencePatch;
}

function mergeTaskPreferencePayloads(payloads: unknown[], logger?: Logger): TaskPreferencePatch {
  const merged: TaskPreferencePatch = {};
  for (const payload of payloads) {
    if (!isRecord(payload)) continue;
    const patch = pickKnownTaskPreferenceKeys(payload);
    const parsed = taskPreferencePatchSchema.safeParse(patch);
    if (!parsed.success) {
      logger?.warn("Skipping invalid task preference payload", {
        issues: parsed.error.issues,
      });
      continue;
    }
    Object.assign(merged, parsed.data);
  }
  return merged;
}

export async function applyTaskPreferencePatchForUser(params: {
  userId: string;
  patch: TaskPreferencePatch;
}) {
  const parsed = taskPreferencePatchSchema.safeParse(params.patch);
  if (!parsed.success) {
    throw new Error("Invalid task preference patch");
  }
  const data = parsed.data;
  if (Object.keys(data).length === 0) return null;
  return prisma.taskPreference.upsert({
    where: { userId: params.userId },
    update: data,
    create: { userId: params.userId, ...data },
  });
}

export async function applyTaskPreferencePayloadsForUser(params: {
  userId: string;
  payloads: unknown[];
  logger?: Logger;
}) {
  const merged = mergeTaskPreferencePayloads(params.payloads, params.logger);
  if (Object.keys(merged).length === 0) return null;
  return applyTaskPreferencePatchForUser({
    userId: params.userId,
    patch: merged,
  });
}

export async function applyTaskPreferencePayloadsForEmailAccount(params: {
  emailAccountId: string;
  payloads: unknown[];
  logger?: Logger;
}) {
  const emailAccount = await prisma.emailAccount.findUnique({
    where: { id: params.emailAccountId },
    select: { userId: true },
  });
  if (!emailAccount) {
    params.logger?.warn("Email account not found for task preference update", {
      emailAccountId: params.emailAccountId,
    });
    return null;
  }
  return applyTaskPreferencePayloadsForUser({
    userId: emailAccount.userId,
    payloads: params.payloads,
    logger: params.logger,
  });
}

export async function applyAiConfigPatch(params: {
  userId: string;
  patch: AiConfigPatch;
}) {
  const parsed = aiConfigPatchSchema.safeParse(params.patch);
  if (!parsed.success) {
    throw new Error("Invalid AI config patch");
  }
  const data = parsed.data;
  if (Object.keys(data).length === 0) return null;
  return prisma.userAIConfig.upsert({
    where: { userId: params.userId },
    update: data,
    create: { userId: params.userId, ...data },
  });
}

export async function applyEmailNotificationSettings(params: {
  emailAccountId: string;
  statsEmailFrequency?: z.infer<typeof frequencySchema>;
  summaryEmailFrequency?: z.infer<typeof frequencySchema>;
}) {
  const data = omitUndefined({
    statsEmailFrequency:
      params.statsEmailFrequency !== undefined
        ? frequencySchema.parse(params.statsEmailFrequency)
        : undefined,
    summaryEmailFrequency:
      params.summaryEmailFrequency !== undefined
        ? frequencySchema.parse(params.summaryEmailFrequency)
        : undefined,
  });
  if (Object.keys(data).length === 0) return null;
  return prisma.emailAccount.update({
    where: { id: params.emailAccountId },
    data,
  });
}

export async function applyDigestScheduleForEmailAccount(params: {
  emailAccountId: string;
  intervalDays: number | null;
  daysOfWeek: number | null;
  timeOfDay: Date | null;
  occurrences: number | null;
}) {
  // Validate only the schedule fields; `emailAccountId` belongs to the caller envelope.
  const parsed = digestScheduleSchema.parse({
    intervalDays: params.intervalDays,
    daysOfWeek: params.daysOfWeek,
    timeOfDay: params.timeOfDay,
    occurrences: params.occurrences,
  });
  const create = {
    emailAccountId: params.emailAccountId,
    intervalDays: parsed.intervalDays,
    daysOfWeek: parsed.daysOfWeek,
    timeOfDay: parsed.timeOfDay,
    occurrences: parsed.occurrences,
    lastOccurrenceAt: new Date(),
    nextOccurrenceAt: calculateNextScheduleDate({
      intervalDays: parsed.intervalDays,
      daysOfWeek: parsed.daysOfWeek,
      timeOfDay: parsed.timeOfDay,
      occurrences: parsed.occurrences,
      lastOccurrenceAt: null,
    }),
  };
  const update = {
    intervalDays: create.intervalDays,
    daysOfWeek: create.daysOfWeek,
    timeOfDay: create.timeOfDay,
    occurrences: create.occurrences,
    lastOccurrenceAt: create.lastOccurrenceAt,
    nextOccurrenceAt: create.nextOccurrenceAt,
  };

  return prisma.schedule.upsert({
    where: { emailAccountId: params.emailAccountId },
    create,
    update,
  });
}

export async function toggleDigestForEmailAccount(params: {
  emailAccountId: string;
  enabled: boolean;
  timeOfDay?: Date;
}) {
  if (params.enabled) {
    const defaultSchedule = {
      intervalDays: 1,
      occurrences: 1,
      daysOfWeek: 127,
      timeOfDay: params.timeOfDay ?? createCanonicalTimeOfDay(9, 0),
    };

    await prisma.schedule.upsert({
      where: { emailAccountId: params.emailAccountId },
      create: {
        emailAccountId: params.emailAccountId,
        ...defaultSchedule,
        lastOccurrenceAt: new Date(),
        nextOccurrenceAt: calculateNextScheduleDate({
          ...defaultSchedule,
          lastOccurrenceAt: null,
        }),
      },
      update: {},
    });

    return { enabled: true };
  }

  await prisma.schedule.deleteMany({
    where: { emailAccountId: params.emailAccountId },
  });
  return { enabled: false };
}

export async function updateAccountAbout(params: {
  emailAccountId: string;
  about: string;
}) {
  return prisma.emailAccount.update({
    where: { id: params.emailAccountId },
    data: { about: params.about },
  });
}

export async function getAssistantPreferenceSnapshot(params: {
  userId: string;
  emailAccountId?: string;
}) {
  const emailAccount = params.emailAccountId
    ? await prisma.emailAccount.findFirst({
        where: { id: params.emailAccountId, userId: params.userId },
        select: {
          id: true,
          about: true,
          timezone: true,
          calendarBookingLink: true,
          statsEmailFrequency: true,
          summaryEmailFrequency: true,
        },
      })
    : await prisma.emailAccount.findFirst({
        where: { userId: params.userId },
        orderBy: { createdAt: "asc" },
        select: {
          id: true,
          about: true,
          timezone: true,
          calendarBookingLink: true,
          statsEmailFrequency: true,
          summaryEmailFrequency: true,
        },
      });

  const [taskPreference, aiConfig, digestSchedule] = await Promise.all([
    prisma.taskPreference.findUnique({
      where: { userId: params.userId },
      select: {
        workHourStart: true,
        workHourEnd: true,
        workDays: true,
        weekStartDay: true,
        bufferMinutes: true,
        selectedCalendarIds: true,
        timeZone: true,
        groupByProject: true,
        defaultMeetingDurationMin: true,
        meetingSlotCount: true,
        meetingExpirySeconds: true,
      },
    }),
    prisma.userAIConfig.findUnique({
      where: { userId: params.userId },
      select: {
        maxSteps: true,
        approvalInstructions: true,
        customInstructions: true,
        conversationCategories: true,
        defaultApprovalExpirySeconds: true,
        toolProfile: true,
        toolAllow: true,
        toolAlsoAllow: true,
        toolDeny: true,
        toolByProvider: true,
        toolByAgent: true,
        toolByGroup: true,
        toolSandboxPolicy: true,
        toolSubagentPolicy: true,
      },
    }),
    emailAccount
      ? prisma.schedule.findUnique({
          where: { emailAccountId: emailAccount.id },
          select: {
            intervalDays: true,
            daysOfWeek: true,
            timeOfDay: true,
            occurrences: true,
            nextOccurrenceAt: true,
          },
        })
      : Promise.resolve(null),
  ]);

  return {
    email: emailAccount,
    scheduling: taskPreference,
    aiConfig,
    digestSchedule,
  };
}
