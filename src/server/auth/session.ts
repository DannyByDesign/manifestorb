import { withAuth } from "@workos-inc/authkit-nextjs";
import { cookies } from "next/headers";
import { createContact as createResendContact } from "@amodel/resend";
import prisma from "@/server/db/client";
import { createScopedLogger } from "@/server/lib/logger";
import { captureException } from "@/server/lib/error";
import {
  clearSpecificErrorMessages,
  ErrorType,
} from "@/server/lib/error-messages";
import { isDuplicateError } from "@/server/db/client-helpers";
import { claimPendingPremiumInvite } from "@/features/premium/server";

const logger = createScopedLogger("auth");

type AuthUser = {
  id: string;
  email: string;
  name: string | null;
};

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
  const { user } = await withAuth();
  if (!user?.email) {
    return null;
  }

  const existingUser = await prisma.user.findUnique({
    where: { email: user.email },
    select: { id: true, email: true, name: true },
  });

  if (existingUser) {
    return { user: existingUser };
  }

  const name = buildDisplayName(user.firstName, user.lastName);

  try {
    const createdUser = await prisma.user.create({
      data: {
        email: user.email,
        name,
        image: user.profilePictureUrl ?? null,
      },
      select: { id: true, email: true, name: true },
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
      const fallbackUser = await prisma.user.findUnique({
        where: { email: user.email },
        select: { id: true, email: true, name: true },
      });
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
    handlePendingPremiumInvite({ email }),
    handleReferralOnSignUp({ userId, email }),
  ]);
}

async function handlePendingPremiumInvite({ email }: { email: string }) {
  try {
    logger.info("Handling pending premium invite", { email });

    const premium = await prisma.premium.findFirst({
      where: { pendingInvites: { has: email } },
      select: {
        id: true,
        stripeSubscriptionId: true,
      },
    });

    if (premium?.stripeSubscriptionId) {
      const user = await prisma.user.findUnique({
        where: { email },
        select: { id: true },
      });

      if (user) {
        await claimPendingPremiumInvite({
          visitorId: user.id,
          premiumId: premium.id,
          email,
        });
        logger.info("Added user to premium from invite", { email });
      }
    }
  } catch (error) {
    logger.error("Error handling pending premium invite", { error, email });
    captureException(error, {
      extra: { email, location: "handlePendingPremiumInvite" },
    });
  }
}

export async function handleReferralOnSignUp({
  userId,
  email,
}: {
  userId: string;
  email: string;
}) {
  try {
    const cookieStore = await cookies();
    const referralCookie = cookieStore.get("referral_code");

    if (!referralCookie?.value) {
      logger.info("No referral code found in cookies", { email });
      return;
    }

    let referralCode = referralCookie.value;
    try {
      referralCode = decodeURIComponent(referralCode);
    } catch {
      // Use original value if decoding fails
    }
    logger.info("Processing referral for new user", {
      email,
      referralCode,
    });

    const { createReferral } = await import("@/features/referrals/referral-code");
    await createReferral(userId, referralCode);
    logger.info("Successfully created referral", {
      email,
      referralCode,
    });
  } catch (error) {
    logger.error("Error processing referral on sign up", {
      error,
      userId,
      email,
    });
    captureException(error, {
      extra: { userId, email, location: "handleReferralOnSignUp" },
    });
  }
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

    await clearSpecificErrorMessages({
      userId: account.userId,
      errorTypes: [ErrorType.ACCOUNT_DISCONNECTED],
      logger,
    });

    return account;
  }
}
