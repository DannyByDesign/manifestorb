"use server";

import { actionClient } from "@/actions/safe-action";
import {
  saveEmailUpdateSettingsBody,
  saveDigestScheduleBody,
  updateDigestItemsBody,
  toggleDigestBody,
} from "@/actions/settings.validation";
import prisma from "@/server/db/client";
import {
  calculateNextScheduleDate,
  createCanonicalTimeOfDay,
} from "@/server/lib/schedule";
import { ActionType, SystemType } from "@/generated/prisma/enums";
import type { Prisma } from "@/generated/prisma/client";

/** Shared logic for email notification settings. Call from actions or AI modify tool. */
export async function applyEmailSettings(
  emailAccountId: string,
  input: { statsEmailFrequency: string; summaryEmailFrequency: string },
) {
  await prisma.emailAccount.update({
    where: { id: emailAccountId },
    data: {
      statsEmailFrequency: input.statsEmailFrequency as "WEEKLY" | "NEVER",
      summaryEmailFrequency: input.summaryEmailFrequency as "WEEKLY" | "NEVER",
    },
  });
}

export const updateEmailSettingsAction = actionClient
  .metadata({ name: "updateEmailSettings" })
  .inputSchema(saveEmailUpdateSettingsBody)
  .action(
    async ({
      ctx: { emailAccountId },
      parsedInput: { statsEmailFrequency, summaryEmailFrequency },
    }) => {
      await applyEmailSettings(emailAccountId, {
        statsEmailFrequency,
        summaryEmailFrequency,
      });
    },
  );

/** Shared logic for digest schedule. Call from actions or AI modify tool. */
export async function applyDigestSchedule(
  emailAccountId: string,
  parsedInput: {
    intervalDays: number | null;
    daysOfWeek: number | null;
    timeOfDay: Date | null;
    occurrences: number | null;
  },
) {
  const create: Prisma.ScheduleUpsertArgs["create"] = {
    emailAccountId,
    intervalDays: parsedInput.intervalDays,
    daysOfWeek: parsedInput.daysOfWeek,
    timeOfDay: parsedInput.timeOfDay,
    occurrences: parsedInput.occurrences,
    lastOccurrenceAt: new Date(),
    nextOccurrenceAt: calculateNextScheduleDate({
      ...parsedInput,
      lastOccurrenceAt: null,
    }),
  };

  const { emailAccountId: _emailAccountId, ...update } = create;

  await prisma.schedule.upsert({
    where: { emailAccountId },
    create,
    update,
  });
}

export const updateDigestScheduleAction = actionClient
  .metadata({ name: "updateDigestSchedule" })
  .inputSchema(saveDigestScheduleBody)
  .action(async ({ ctx: { emailAccountId }, parsedInput }) => {
    await applyDigestSchedule(emailAccountId, parsedInput);
    return { success: true };
  });

export const updateDigestItemsAction = actionClient
  .metadata({ name: "updateDigestItems" })
  .inputSchema(updateDigestItemsBody)
  .action(
    async ({
      ctx: { emailAccountId, logger },
      parsedInput: { ruleDigestPreferences },
    }) => {
      const promises = Object.entries(ruleDigestPreferences).map(
        async ([ruleId, enabled]) => {
          // Verify the rule belongs to this email account
          const rule = await prisma.rule.findUnique({
            where: {
              id: ruleId,
              emailAccountId,
            },
            select: { id: true, actions: true },
          });

          if (!rule) {
            logger.error("Rule not found", { ruleId });
            return;
          }

          const hasDigestAction = rule.actions.some(
            (action) => action.type === ActionType.DIGEST,
          );

          if (enabled && !hasDigestAction) {
            // Add DIGEST action
            await prisma.action.create({
              data: {
                ruleId: rule.id,
                type: ActionType.DIGEST,
              },
            });
          } else if (!enabled && hasDigestAction) {
            // Remove DIGEST action
            await prisma.action.deleteMany({
              where: {
                ruleId: rule.id,
                type: ActionType.DIGEST,
              },
            });
          }
        },
      );

      await Promise.all(promises);
      return { success: true };
    },
  );

/** Shared logic for toggling digest on/off. Call from actions or AI modify tool. */
export async function applyToggleDigest(
  emailAccountId: string,
  input: { enabled: boolean; timeOfDay?: Date },
) {
  const { enabled, timeOfDay } = input;
  if (enabled) {
    const defaultSchedule = {
      intervalDays: 1,
      occurrences: 1,
      daysOfWeek: 127,
      timeOfDay: timeOfDay ?? createCanonicalTimeOfDay(9, 0),
    };

    await prisma.schedule.upsert({
      where: { emailAccountId },
      create: {
        emailAccountId,
        ...defaultSchedule,
        lastOccurrenceAt: new Date(),
        nextOccurrenceAt: calculateNextScheduleDate({
          ...defaultSchedule,
          lastOccurrenceAt: null,
        }),
      },
      update: {},
    });

    const newsletterRule = await prisma.rule.findFirst({
      where: { emailAccountId, systemType: SystemType.NEWSLETTER },
      include: { actions: true },
    });

    if (
      newsletterRule &&
      !newsletterRule.actions.some((a) => a.type === ActionType.DIGEST)
    ) {
      await prisma.action.create({
        data: { ruleId: newsletterRule.id, type: ActionType.DIGEST },
      });
    }
  } else {
    await prisma.schedule.deleteMany({
      where: { emailAccountId },
    });
  }
}

export const toggleDigestAction = actionClient
  .metadata({ name: "toggleDigest" })
  .inputSchema(toggleDigestBody)
  .action(
    async ({
      ctx: { emailAccountId },
      parsedInput: { enabled, timeOfDay },
    }) => {
      await applyToggleDigest(emailAccountId, { enabled, timeOfDay });
      return { success: true };
    },
  );
