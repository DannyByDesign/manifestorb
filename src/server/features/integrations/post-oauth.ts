/**
 * Post-OAuth orchestrator: after a successful OAuth flow, set up email watching
 * and optionally notify the user. Fire-and-forget from callback.
 */
import { createScopedLogger } from "@/server/lib/logger";

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
    logger.info("Post-OAuth integration setup complete", {
      userId,
      accountId,
      provider,
      services,
      errors,
    });
  }

  return { services, errors };
}
