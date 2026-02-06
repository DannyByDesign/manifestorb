import { setUser } from "@sentry/nextjs";
import { trackError } from "@/server/lib/posthog";
import { auth } from "@/server/auth";
import type { Logger } from "@/server/lib/logger";

export async function logErrorToPosthog(
  type: "api" | "action",
  url: string,
  errorType: string,
  emailAccountId: string,
  logger: Logger,
) {
  try {
    const session = await auth();
    if (session?.user.email) {
      setUser({ email: session.user.email });
      await trackError({
        email: session.user.email,
        emailAccountId,
        errorType,
        type,
        url,
      });
    }
  } catch (error) {
    logger.error("Error logging to PostHog:", { error });
  }
}
