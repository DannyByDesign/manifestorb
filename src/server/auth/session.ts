import { withAuth } from "@workos-inc/authkit-nextjs";
import { createContact as createResendContact } from "@amodel/resend";
import prisma from "@/server/db/client";
import { createScopedLogger } from "@/server/lib/logger";
import { captureException } from "@/server/lib/error";
import {
  clearSpecificErrorMessages,
  ErrorType,
} from "@/server/lib/error-messages";
import { isDuplicateError } from "@/server/db/client-helpers";
import { clearInvalidGrantFailures } from "@/server/auth/oauth-refresh-failure-policy";

const logger = createScopedLogger("auth");

type AuthUser = {
  id: string;
  email: string;
  name: string | null;
  workosSubject: string | null;
};

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function findUserByEmailWithRetry(
  email: string,
  attempts = 3,
): Promise<AuthUser | null> {
  const normalizedEmail = email.trim();

  for (let attempt = 0; attempt < attempts; attempt += 1) {
    const existingUser =
      (await prisma.user.findUnique({
        where: { email: normalizedEmail },
        select: { id: true, email: true, name: true, workosSubject: true },
      })) ??
      (await prisma.user.findFirst({
        where: {
          email: {
            equals: normalizedEmail,
            mode: "insensitive",
          },
        },
        select: { id: true, email: true, name: true, workosSubject: true },
      }));
    if (existingUser) {
      return existingUser;
    }

    // Another concurrent request may have just created this user.
    if (attempt < attempts - 1) {
      await wait(40 * (attempt + 1));
    }
  }

  return null;
}

async function findUserByWorkosSubjectWithRetry(
  workosSubject: string,
  attempts = 2,
): Promise<AuthUser | null> {
  const normalizedSubject = workosSubject.trim();
  if (!normalizedSubject) return null;

  for (let attempt = 0; attempt < attempts; attempt += 1) {
    const existingUser = await prisma.user.findUnique({
      where: { workosSubject: normalizedSubject },
      select: { id: true, email: true, name: true, workosSubject: true },
    });
    if (existingUser) return existingUser;

    if (attempt < attempts - 1) {
      await wait(40 * (attempt + 1));
    }
  }

  return null;
}

const buildDisplayName = (
  firstName?: string | null,
  lastName?: string | null,
): string | null => {
  const parts = [firstName, lastName]
    .map((part) => (part ?? "").trim())
    .filter((part) => part.length > 0);
  return parts.length > 0 ? parts.join(" ") : null;
};

export const auth = async (): Promise<{ user: AuthUser } | null> => {
  let authResult: Awaited<ReturnType<typeof withAuth>>;
  try {
    authResult = await withAuth();
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    // Next.js may attempt to pre-render pages during build; WorkOS auth relies on request headers/cookies.
    // Avoid spamming logs for expected "dynamic server usage" errors in that context.
    if (message.includes("Dynamic server usage")) {
      return null;
    }
    logger.warn("WorkOS auth lookup failed", { error: message });
    return null;
  }

  const { user } = authResult;
  if (!user?.email) {
    return null;
  }

  const email = user.email.trim();
  const workosSubject = typeof user.id === "string" ? user.id.trim() : "";
  const normalizedWorkosSubject = workosSubject.length > 0 ? workosSubject : null;
  const name = buildDisplayName(user.firstName, user.lastName);

  if (normalizedWorkosSubject) {
    const existingBySubject = await findUserByWorkosSubjectWithRetry(
      normalizedWorkosSubject,
      2,
    );
    if (existingBySubject) {
      const shouldRefreshIdentity =
        existingBySubject.email !== email ||
        (existingBySubject.name ?? null) !== (name ?? null);

      if (shouldRefreshIdentity) {
        const updatedBySubject = await prisma.user.update({
          where: { id: existingBySubject.id },
          data: {
            email,
            name,
            image: user.profilePictureUrl ?? null,
          },
          select: { id: true, email: true, name: true, workosSubject: true },
        });
        return { user: updatedBySubject };
      }

      return { user: existingBySubject };
    }
  }

  const existingUser = await findUserByEmailWithRetry(email, 2);

  if (existingUser) {
    if (normalizedWorkosSubject && !existingUser.workosSubject) {
      try {
        const updatedByEmail = await prisma.user.update({
          where: { id: existingUser.id },
          data: { workosSubject: normalizedWorkosSubject },
          select: { id: true, email: true, name: true, workosSubject: true },
        });
        return { user: updatedByEmail };
      } catch (error) {
        logger.warn("Failed to backfill workos subject for existing user", {
          userId: existingUser.id,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    } else if (
      normalizedWorkosSubject &&
      existingUser.workosSubject &&
      existingUser.workosSubject !== normalizedWorkosSubject
    ) {
      logger.warn("WorkOS subject mismatch for existing user", {
        userId: existingUser.id,
        existingSubject: existingUser.workosSubject,
        incomingSubject: normalizedWorkosSubject,
      });
    }
    return { user: existingUser };
  }

  try {
    const createdUser = await prisma.user.create({
      data: {
        email,
        name,
        image: user.profilePictureUrl ?? null,
        workosSubject: normalizedWorkosSubject,
      },
      select: { id: true, email: true, name: true, workosSubject: true },
    });

    await postSignUp({
      id: createdUser.id,
      email: createdUser.email,
      name: createdUser.name,
      image: user.profilePictureUrl ?? null,
    });

    return { user: createdUser };
  } catch (error) {
    if (isDuplicateError(error)) {
      const fallbackUser = await findUserByEmailWithRetry(email, 5);
      if (fallbackUser) {
        return { user: fallbackUser };
      }
    }

    throw error;
  }
};

async function postSignUp({
  id: userId,
  email,
  name,
  image,
}: {
  id: string;
  email: string;
  name?: string | null;
  image?: string | null;
}) {
  const resend = createResendContact({ email }).catch((error) => {
    logger.error("Error creating Resend contact", {
      email,
      error,
    });
    captureException(error, { userEmail: email });
  });

  await Promise.all([
    resend,
  ]);
}

export async function saveTokens({
  tokens,
  accountRefreshToken,
  providerAccountId,
  emailAccountId,
  provider,
}: {
  tokens: {
    access_token?: string;
    refresh_token?: string;
    expires_at?: number;
  };
  accountRefreshToken: string | null;
  provider: string;
} & (
  | {
      providerAccountId: string;
      emailAccountId?: never;
    }
  | {
      emailAccountId: string;
      providerAccountId?: never;
    }
)) {
  const refreshToken = tokens.refresh_token ?? accountRefreshToken;

  if (!refreshToken) {
    logger.error("Attempted to save null refresh token", { providerAccountId });
    captureException("Cannot save null refresh token", {
      extra: { providerAccountId },
    });
    return;
  }

  const data = {
    access_token: tokens.access_token,
    expires_at: tokens.expires_at ? new Date(tokens.expires_at * 1000) : null,
    refresh_token: refreshToken,
    disconnectedAt: null,
  };

  if (emailAccountId) {
    const emailAccount = await prisma.emailAccount.findUnique({
      where: { id: emailAccountId },
      select: { accountId: true, userId: true },
    });
    if (!emailAccount) {
      logger.error("Email account not found for saveTokens", {
        emailAccountId,
      });
      return;
    }
    await prisma.account.update({
      where: { id: emailAccount.accountId },
      data,
    });

    await clearInvalidGrantFailures({
      provider,
      accountId: emailAccount.accountId,
      logger,
    });

    await clearSpecificErrorMessages({
      userId: emailAccount.userId,
      errorTypes: [ErrorType.ACCOUNT_DISCONNECTED],
      logger,
    });
  } else {
    if (!providerAccountId) {
      logger.error("No providerAccountId found in database", {
        emailAccountId,
      });
      captureException("No providerAccountId found in database", {
        extra: { emailAccountId },
      });
      return;
    }

    const account = await prisma.account.update({
      where: {
        provider_providerAccountId: {
          provider,
          providerAccountId,
        },
      },
      data,
    });

    await clearInvalidGrantFailures({
      provider,
      accountId: account.id,
      logger,
    });

    await clearSpecificErrorMessages({
      userId: account.userId,
      errorTypes: [ErrorType.ACCOUNT_DISCONNECTED],
      logger,
    });

    return account;
  }
}
