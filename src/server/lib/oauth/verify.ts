import prisma from "@/server/db/client";
import { auth } from "@/server/auth";
import type { Logger } from "@/server/lib/logger";
import { RedirectError } from "./redirect";

/**
 * Verify the current user owns the specified email account.
 * Throws RedirectError if unauthorized.
 */
export async function verifyEmailAccountAccess(
  emailAccountId: string,
  logger: Logger,
  redirectUrl: URL,
  responseHeaders: Headers,
): Promise<{ userId: string }> {
  const session = await auth();
  if (!session?.user?.id) {
    logger.warn("Unauthorized OAuth callback - no session");
    redirectUrl.searchParams.set("error", "unauthorized");
    throw new RedirectError(redirectUrl, responseHeaders);
  }

  const emailAccount = await prisma.emailAccount.findFirst({
    where: {
      id: emailAccountId,
      userId: session.user.id,
    },
    select: { id: true },
  });

  if (!emailAccount) {
    logger.warn("Unauthorized OAuth callback - invalid email account", {
      emailAccountId,
      userId: session.user.id,
    });
    redirectUrl.searchParams.set("error", "forbidden");
    throw new RedirectError(redirectUrl, responseHeaders);
  }

  return { userId: session.user.id };
}
