/**
 * Post-OAuth orchestrator: after a successful OAuth flow, set up email watching
 * and optionally notify the user. Fire-and-forget from callback.
 */
import { createScopedLogger } from "@/server/lib/logger";
import prisma from "@/server/db/client";

const logger = createScopedLogger("post-oauth");

export async function setupIntegrationsAfterOAuth({
  userId,
  accountId,
  provider,
}: {
  userId: string;
  accountId?: string;
  provider: string;
}): Promise<{ services: string[]; errors: string[] }> {
  const services: string[] = [];
  const errors: string[] = [];

  try {
    const { ensureEmailAccountsWatched } = await import(
      "@/server/features/email/watch-manager"
    );
    await ensureEmailAccountsWatched({
      userIds: [userId],
      logger,
    });
    services.push("email");
    logger.info("Email watching set up after OAuth", { userId });
  } catch (error) {
    logger.error("Failed to set up email watching after OAuth", { error, userId });
    errors.push("email");
  }

  if (services.length > 0) {
    try {
      const { createInAppNotification } = await import(
        "@/server/features/notifications/create"
      );
      await createInAppNotification({
        userId,
        title: "Account connected",
        body:
          errors.length > 0
            ? `Email sync is set up. Some services could not be connected: ${errors.join(", ")}.`
            : "Your account is connected. Email sync has been set up.",
        type: "info",
        dedupeKey: `oauth-setup-${accountId ?? userId}-${provider}`,
      });
    } catch (e) {
      logger.warn("Failed to send post-OAuth notification", { error: e });
    }
  }

  return { services, errors };
}
