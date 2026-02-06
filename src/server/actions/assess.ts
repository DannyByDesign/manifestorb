"use server";

import prisma from "@/server/db/client";
import { assessUser } from "@/server/lib/assess";
import { aiAnalyzeWritingStyle } from "@/features/knowledge/ai/writing-style";
import { formatBulletList } from "@/server/lib/string";
import { getEmailForLLM } from "@/server/lib/get-email-from-message";
import { actionClient } from "@/actions/safe-action";
import { createEmailProvider } from "@/features/email/provider";
import { SafeError } from "@/server/lib/error";

// to help with onboarding and provide the best flow to new users
export const assessAction = actionClient
  .metadata({ name: "assessUser" })
  .action(async ({ ctx: { emailAccountId, provider, logger } }) => {
    const emailProvider = await createEmailProvider({
      emailAccountId,
      provider,
      logger,
    });

    const emailAccount = await prisma.emailAccount.findUnique({
      where: { id: emailAccountId },
      select: { behaviorProfile: true },
    });

    if (emailAccount?.behaviorProfile) return { success: true, skipped: true };

    const result = await assessUser({ client: emailProvider, logger });
    await prisma.emailAccount.update({
      where: { id: emailAccountId },
      data: { behaviorProfile: result },
    });

    return { success: true };
  });

export const analyzeWritingStyleAction = actionClient
  .metadata({ name: "analyzeWritingStyle" })
  .action(async ({ ctx: { emailAccountId, provider, logger } }) => {
    const emailAccount = await prisma.emailAccount.findUnique({
      where: { id: emailAccountId },
      select: {
        writingStyle: true,
        id: true,
        userId: true,
        email: true,
        about: true,
        filingEnabled: true,
        filingPrompt: true,
        multiRuleSelectionEnabled: true,
        timezone: true,
        calendarBookingLink: true,
      },
    });

    if (!emailAccount) throw new SafeError("Email account not found");

    if (emailAccount?.writingStyle) return { success: true, skipped: true };

    // fetch last 20 sent emails using the provider's getSentMessages method
    const emailProvider = await createEmailProvider({
      emailAccountId,
      provider,
      logger,
    });
    const sentMessages = await emailProvider.getSentMessages(20);

    // analyze writing style
    const style = await aiAnalyzeWritingStyle({
      emails: sentMessages.map((email) =>
        getEmailForLLM(email, { extractReply: true }),
      ),
      emailAccount: { ...emailAccount, account: { provider } },
    });

    if (!style) return;

    // save writing style
    const writingStyle = [
      style.typicalLength ? `Typical Length: ${style.typicalLength}` : null,
      style.formality ? `Formality: ${style.formality}` : null,
      style.commonGreeting ? `Common Greeting: ${style.commonGreeting}` : null,
      style.notableTraits.length
        ? `Notable Traits: ${formatBulletList(style.notableTraits)}`
        : null,
      style.examples.length
        ? `Examples: ${formatBulletList(style.examples)}`
        : null,
    ]
      .filter(Boolean)
      .join("\n");

    await prisma.emailAccount.update({
      where: { id: emailAccountId },
      data: { writingStyle },
    });

    return { success: true };
  });
