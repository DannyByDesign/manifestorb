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
  applyDigestScheduleForEmailAccount,
  applyEmailNotificationSettings,
  toggleDigestForEmailAccount,
} from "@/features/preferences/service";

/** Shared logic for email notification settings. Call from actions or AI modify tool. */
export async function applyEmailSettings(
  emailAccountId: string,
  input: { statsEmailFrequency: string; summaryEmailFrequency: string },
) {
  await applyEmailNotificationSettings({
    emailAccountId,
    statsEmailFrequency: input.statsEmailFrequency as "NEVER" | "DAILY" | "WEEKLY",
    summaryEmailFrequency: input.summaryEmailFrequency as "NEVER" | "DAILY" | "WEEKLY",
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
  await applyDigestScheduleForEmailAccount({
    emailAccountId,
    intervalDays: parsedInput.intervalDays,
    daysOfWeek: parsedInput.daysOfWeek,
    timeOfDay: parsedInput.timeOfDay,
    occurrences: parsedInput.occurrences,
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
          const rule = await prisma.canonicalRule.findUnique({
            where: {
              id: ruleId,
              emailAccountId,
            },
            select: { id: true, preferencePatch: true },
          });

          if (!rule) {
            logger.error("Rule not found", { ruleId });
            return;
          }

          const existingPatch =
            rule.preferencePatch &&
            typeof rule.preferencePatch === "object" &&
            !Array.isArray(rule.preferencePatch)
              ? (rule.preferencePatch as Record<string, unknown>)
              : {};

          await prisma.canonicalRule.update({
            where: { id: rule.id },
            data: {
              preferencePatch: {
                ...existingPatch,
                digestEnabled: enabled,
              },
            },
          });
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
  await toggleDigestForEmailAccount({
    emailAccountId,
    enabled: input.enabled,
    timeOfDay: input.timeOfDay,
  });
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
