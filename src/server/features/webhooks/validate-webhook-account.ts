import { NextResponse } from "next/server";
import prisma from "@/server/db/client";
import type { Logger } from "@/server/lib/logger";
import { listEffectiveCanonicalRules } from "@/server/features/policy-plane/repository";
import { isRuleActiveNow } from "@/server/features/policy-plane/canonical-schema";

export async function getWebhookEmailAccount(
  where: { email: string } | { watchEmailsSubscriptionId: string },
  logger: Logger,
) {
  const query = {
    select: {
      id: true,
      email: true,
      userId: true,
      about: true,
      multiRuleSelectionEnabled: true,
      timezone: true,
      calendarBookingLink: true,
      lastSyncedHistoryId: true,
      autoCategorizeSenders: true,
      aiRuleTimeoutMs: true,
      watchEmailsSubscriptionId: true,
      watchEmailsSubscriptionHistory: true,
      account: {
        select: {
          provider: true,
          access_token: true,
          refresh_token: true,
          expires_at: true,
          disconnectedAt: true,
        },
      },
      user: {
        select: { id: true },
      },
    },
  };

  if ("email" in where) {
    return await prisma.emailAccount.findUnique({
      where: { email: where.email },
      ...query,
    });
  }

  let emailAccount = await prisma.emailAccount.findFirst({
    where: { watchEmailsSubscriptionId: where.watchEmailsSubscriptionId },
    ...query,
  });

  if (!emailAccount) {
    logger.info("Subscription not found in current field, checking history", {
      subscriptionId: where.watchEmailsSubscriptionId,
    });

    const [foundAccount] = await prisma.$queryRaw<Array<{ id: string }>>`
      SELECT id FROM "EmailAccount"
      WHERE "watchEmailsSubscriptionHistory" @> ${JSON.stringify([
      { subscriptionId: where.watchEmailsSubscriptionId },
    ])}::jsonb
      LIMIT 1
    `;

    if (foundAccount) {
      emailAccount = await prisma.emailAccount.findUnique({
        where: { id: foundAccount.id },
        ...query,
      });

      if (emailAccount) {
        logger.info("Found account by historical subscription ID", {
          subscriptionId: where.watchEmailsSubscriptionId,
          email: emailAccount.email,
          currentSubscriptionId: emailAccount.watchEmailsSubscriptionId,
        });
      }
    }
  }

  if (!emailAccount) {
    logger.error("Account not found", where);
  }

  return emailAccount;
}

export type ValidatedWebhookAccountData = Awaited<
  ReturnType<typeof getWebhookEmailAccount>
>;

export type ValidatedWebhookAccount = {
  emailAccount: NonNullable<ValidatedWebhookAccountData>;
  hasAutomationRules: boolean;
  hasAiAccess: boolean;
};

type ValidationResult =
  | { success: true; data: ValidatedWebhookAccount }
  | { success: false; response: NextResponse };

export async function validateWebhookAccount(
  emailAccount: ValidatedWebhookAccountData | null,
  logger: Logger,
): Promise<ValidationResult> {
  if (!emailAccount) {
    logger.error("Account not found");
    return { success: false, response: NextResponse.json({ ok: true }) };
  }

  if (emailAccount.account?.disconnectedAt) {
    logger.info("Skipping disconnected account");
    return { success: false, response: NextResponse.json({ ok: true }) };
  }

  const canonicalRules = await listEffectiveCanonicalRules({
    userId: emailAccount.userId,
    emailAccountId: emailAccount.id,
    type: "automation",
  });
  const hasAutomationRules = canonicalRules.some((rule) =>
    isRuleActiveNow({
      enabled: rule.enabled,
      expiresAt: rule.expiresAt,
      disabledUntil: rule.disabledUntil,
    }),
  );

  if (!hasAutomationRules) {
    logger.info("Has no rules enabled");
    return { success: false, response: NextResponse.json({ ok: true }) };
  }

  if (
    !emailAccount.account?.access_token ||
    !emailAccount.account?.refresh_token
  ) {
    logger.error("Missing access or refresh token");
    return { success: false, response: NextResponse.json({ ok: true }) };
  }

  return {
    success: true,
    data: {
      emailAccount,
      hasAutomationRules,
      hasAiAccess: true,
    },
  };
}
