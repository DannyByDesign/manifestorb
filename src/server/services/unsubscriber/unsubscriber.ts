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

      // If status is UNSUBSCRIBED, attempt to execute unsubscribe logic
      if (status === "UNSUBSCRIBED") {
        // We fire and forget this for now, or we could await it.
        // Importing dynamically to avoid circular deps if any
        const { unsubscribeFromSender } = await import("@/server/services/unsubscriber/execute");

        // We don't await the result to keep UI snappy, but we log errors in background
        unsubscribeFromSender({
          emailAccountId,
          senderEmail: newsletterEmail // extractEmailAddress handled in caller? No, we extracted it to `email`.
        }).catch(err => console.error("Unsubscribe background task failed", err));
      }

      return result;
    },
  );
