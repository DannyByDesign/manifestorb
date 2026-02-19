import prisma from "@/server/db/client";
import type { Logger } from "@/server/lib/logger";
import { sendReconnectionEmail } from "@amodel/resend";
import { env } from "@/env";
import { addUserErrorMessage, ErrorType } from "@/server/lib/error-messages";
import { createUnsubscribeToken } from "@/server/lib/unsubscribe";
import { recordInvalidGrantFailure } from "@/server/auth/oauth-refresh-failure-policy";

export type CleanupInvalidTokensResult =
  | { status: "not_found" | "already_disconnected" }
  | { status: "deferred"; attempts: number; threshold: number }
  | { status: "disconnected" };

/**
 * Handles permanent auth failures.
 * For invalid_grant we require repeated failures before hard disconnect
 * to avoid destructive one-off disconnects caused by transient auth faults.
 * Used for:
 * - invalid_grant: User revoked access or tokens expired
 * - insufficientPermissions: User hasn't granted all required scopes
 */
export async function cleanupInvalidTokens({
  emailAccountId,
  reason,
  logger,
}: {
  emailAccountId: string;
  reason: "invalid_grant" | "insufficient_permissions";
  logger: Logger;
}): Promise<CleanupInvalidTokensResult> {
  logger.info("Cleaning up invalid tokens", { reason });

  const emailAccount = await prisma.emailAccount.findUnique({
    where: { id: emailAccountId },
    select: {
      id: true,
      email: true,
      accountId: true,
      userId: true,
      watchEmailsExpirationDate: true,
      account: {
        select: {
          disconnectedAt: true,
          provider: true,
        },
      },
    },
  });

  if (!emailAccount) {
    logger.warn("Email account not found");
    return { status: "not_found" };
  }

  if (emailAccount.account?.disconnectedAt) {
    logger.info("Account already marked as disconnected");
    return { status: "already_disconnected" };
  }

  if (reason === "invalid_grant") {
    const decision = await recordInvalidGrantFailure({
      provider: emailAccount.account?.provider ?? "unknown",
      accountId: emailAccount.accountId,
      logger,
    });

    if (!decision.shouldDisconnect) {
      logger.warn(
        "Deferring hard disconnect after invalid_grant (waiting for repeated confirmation)",
        {
          emailAccountId,
          accountId: emailAccount.accountId,
          attempts: decision.attempts,
          threshold: decision.threshold,
        },
      );
      return {
        status: "deferred",
        attempts: decision.attempts,
        threshold: decision.threshold,
      };
    }
  }

  const updated = await prisma.account.updateMany({
    where: { id: emailAccount.accountId, disconnectedAt: null },
    data: {
      access_token: null,
      expires_at: null,
      disconnectedAt: new Date(),
    },
  });

  if (updated.count === 0) {
    logger.info(
      "Account already marked as disconnected (via concurrent update)",
    );
    return { status: "already_disconnected" };
  }

  if (reason === "invalid_grant") {
    const isWatched =
      !!emailAccount.watchEmailsExpirationDate &&
      emailAccount.watchEmailsExpirationDate > new Date();

    if (isWatched) {
      try {
        const unsubscribeToken = await createUnsubscribeToken({
          emailAccountId: emailAccount.id,
        });

        await sendReconnectionEmail({
          from: env.RESEND_FROM_EMAIL,
          to: emailAccount.email,
          emailProps: {
            baseUrl: env.NEXT_PUBLIC_BASE_URL,
            email: emailAccount.email,
            unsubscribeToken,
          },
        });
        logger.info("Reconnection email sent", { email: emailAccount.email });
      } catch (error) {
        logger.error("Failed to send reconnection email", {
          email: emailAccount.email,
          error,
        });
      }
    } else {
      logger.info(
        "Skipping reconnection email - account not currently watched",
      );
    }

    await addUserErrorMessage(
      emailAccount.userId,
      ErrorType.ACCOUNT_DISCONNECTED,
      `The connection for ${emailAccount.email} was disconnected. Please reconnect your account to resume automation.`,
      logger,
    );
  }

  logger.info("Account marked disconnected - user must re-authenticate", {
    reason,
  });
  return { status: "disconnected" };
}
