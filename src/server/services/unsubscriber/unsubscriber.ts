"use server";

import prisma from "@/server/db/client";
import { setNewsletterStatusBody } from "@/server/services/unsubscriber/unsubscriber.validation";
import { extractEmailAddress } from "@/server/integrations/google";
import { actionClient } from "@/server/services/unsubscriber/safe-action";

export const setNewsletterStatusAction = actionClient
  .metadata({ name: "setNewsletterStatus" })
  .inputSchema(setNewsletterStatusBody)
  .action(
    async ({
      parsedInput: { newsletterEmail, status },
      ctx: { emailAccountId },
    }) => {
      const email = extractEmailAddress(newsletterEmail);

      return await prisma.newsletter.upsert({
        where: {
          email_emailAccountId: { email, emailAccountId },
        },
        create: {
          status,
          email,
          emailAccountId,
        },
        update: { status },
      });
    },
  );
