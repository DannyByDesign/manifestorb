import sumBy from "lodash/sumBy";
import { after } from "next/server";

import { updateStripeSubscriptionItemQuantity } from "@/enterprise/billing/stripe/index";
import prisma from "@/server/db/client";
import type { PremiumTier } from "@/generated/prisma/enums";
import { createScopedLogger } from "@/server/utils/logger";
import { ensureEmailAccountsWatched } from "@/server/services/email/watch-manager";
import { hasTierAccess, isPremium } from "@/server/utils/premium";
import { SafeError } from "@/server/utils/error";
import { env } from "@/env";

const logger = createScopedLogger("premium");





export async function updateAccountSeats({ userId }: { userId: string }) {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { premium: { select: { id: true } } },
  });

  if (!user) throw new Error(`User not found for id ${userId}`);

  if (!user.premium) {
    logger.warn("User has no premium", { userId });
    return;
  }

  await syncPremiumSeats(user.premium.id);
}

export async function syncPremiumSeats(premiumId: string) {
  const premium = await prisma.premium.findUnique({
    where: { id: premiumId },
    select: {
      stripeSubscriptionItemId: true,
      users: {
        select: { _count: { select: { emailAccounts: true } } },
      },
    },
  });

  if (!premium) {
    logger.warn("Premium not found", { premiumId });
    return;
  }

  const totalSeats = sumBy(premium.users, (user) => user._count.emailAccounts);
  await updateAccountSeatsForPremium(premium, totalSeats);
}

export async function addUserToPremium({
  visitorId,
  premiumId,
}: {
  visitorId: string;
  premiumId: string;
}) {
  await prisma.premium.update({
    where: { id: premiumId },
    data: { users: { connect: { id: visitorId } } },
  });
  await syncPremiumSeats(premiumId);
}

export async function removeUserFromPremium({
  visitorId,
  premiumId,
}: {
  visitorId: string;
  premiumId: string;
}) {
  await prisma.premium.update({
    where: { id: premiumId },
    data: { users: { disconnect: { id: visitorId } } },
  });
  await syncPremiumSeats(premiumId);
}

export async function removeFromPendingInvites({
  email,
  premiumId,
}: {
  email: string;
  premiumId: string;
}) {
  const premium = await prisma.premium.findUnique({
    where: { id: premiumId },
    select: { pendingInvites: true },
  });

  if (!premium) return;

  const currentPendingInvites = premium.pendingInvites || [];
  const updatedPendingInvites = currentPendingInvites.filter(
    (e) => e !== email,
  );

  if (currentPendingInvites.length !== updatedPendingInvites.length) {
    await prisma.premium.update({
      where: { id: premiumId },
      data: { pendingInvites: { set: updatedPendingInvites } },
    });
  }
}

export async function claimPendingPremiumInvite({
  visitorId,
  email,
  premiumId,
}: {
  visitorId: string;
  email: string;
  premiumId: string;
}) {
  await removeFromPendingInvites({ email, premiumId });
  await addUserToPremium({ visitorId, premiumId });
}

export async function updateAccountSeatsForPremium(
  premium: {
    stripeSubscriptionItemId: string | null;
  },
  totalSeats: number,
) {
  if (premium.stripeSubscriptionItemId) {
    await updateStripeSubscriptionItemQuantity({
      subscriptionItemId: premium.stripeSubscriptionItemId,
      quantity: totalSeats,
      logger,
    });
  }
}

export async function checkHasAccess({
  userId,
  minimumTier,
}: {
  userId: string;
  minimumTier: PremiumTier;
}): Promise<boolean> {
  if (env.NEXT_PUBLIC_BYPASS_PREMIUM_CHECKS) return true;

  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: {
      premium: {
        select: {
          tier: true,
          stripeSubscriptionStatus: true,
        },
      },
    },
  });

  if (!user) throw new SafeError("User not found");

  if (!isPremium(user?.premium?.stripeSubscriptionStatus || null)) {
    return false;
  }

  return hasTierAccess({
    tier: user.premium?.tier || null,
    minimumTier,
  });
}
