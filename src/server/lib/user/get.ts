import prisma from "@/server/db/client";
import type { EmailAccountWithAI } from "@/server/lib/llms/types";
import type { Prisma } from "@/generated/prisma/client";

export type EmailAccountWithAIAndTokens = Prisma.EmailAccountGetPayload<{
  select: {
    id: true;
    userId: true;
    email: true;
    about: true;
    filingEnabled: true;
    filingPrompt: true;
    multiRuleSelectionEnabled: true;
    timezone: true;
    calendarBookingLink: true;
    aiRuleTimeoutMs: true;
    account: {
      select: {
        access_token: true;
        refresh_token: true;
        expires_at: true;
        provider: true;
      };
    };
  };
}> & {
  tokens: {
    access_token: string | null;
    refresh_token: string | null;
    expires_at: number | null;
  };
};

export async function getEmailAccountWithAi({
  emailAccountId,
}: {
  emailAccountId: string;
}): Promise<(EmailAccountWithAI & { name: string | null }) | null> {
  return prisma.emailAccount.findUnique({
    where: { id: emailAccountId },
    select: {
      id: true,
      userId: true,
      email: true,
      about: true,
      filingEnabled: true,
      filingPrompt: true,
      multiRuleSelectionEnabled: true,
      timezone: true,
      calendarBookingLink: true,
      aiRuleTimeoutMs: true,
      name: true,
      account: {
        select: {
          provider: true,
        },
      },
    },
  });
}

export async function getEmailAccountWithAiAndTokens({
  emailAccountId,
}: {
  emailAccountId: string;
}): Promise<EmailAccountWithAIAndTokens | null> {
  const emailAccount = await prisma.emailAccount.findUnique({
    where: { id: emailAccountId },
    select: {
      id: true,
      userId: true,
      email: true,
      about: true,
      filingEnabled: true,
      filingPrompt: true,
      multiRuleSelectionEnabled: true,
      timezone: true,
      calendarBookingLink: true,
      aiRuleTimeoutMs: true,
      account: {
        select: {
          access_token: true,
          refresh_token: true,
          expires_at: true,
          provider: true,
        },
      },
    },
  });

  if (!emailAccount) return null;

  return {
    ...emailAccount,
    tokens: {
      ...emailAccount.account,
      expires_at: emailAccount.account.expires_at?.getTime() ?? null,
    },
  };
}

export async function getUserPremium({ userId }: { userId: string }) {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { premium: true },
  });

  return user?.premium || null;
}

export async function getWritingStyle({
  emailAccountId,
}: {
  emailAccountId: string;
}) {
  const writingStyle = await prisma.emailAccount.findUnique({
    where: { id: emailAccountId },
    select: { writingStyle: true },
  });

  return writingStyle?.writingStyle || null;
}
