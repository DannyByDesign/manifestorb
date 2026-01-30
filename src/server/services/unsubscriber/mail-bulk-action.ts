"use server";

import { z } from "zod";
import { actionClient } from "@/server/services/unsubscriber/safe-action";
import { createEmailProvider } from "@/server/services/email/provider";

export const bulkArchiveAction = actionClient
  .metadata({ name: "bulkArchive" })
  .inputSchema(
    z.object({
      froms: z.array(z.string()),
    }),
  )
  .action(
    async ({
      ctx: { emailAccountId, provider, emailAccount, logger },
      parsedInput: { froms },
    }) => {
      const emailProvider = await createEmailProvider({
        emailAccountId,
        provider,
        logger,
      });

      await emailProvider.bulkArchiveFromSenders(
        froms,
        emailAccount.email,
        emailAccountId,
      );
    },
  );

export const bulkTrashAction = actionClient
  .metadata({ name: "bulkTrash" })
  .inputSchema(
    z.object({
      froms: z.array(z.string()),
    }),
  )
  .action(
    async ({
      ctx: { emailAccountId, provider, emailAccount, logger },
      parsedInput: { froms },
    }) => {
      const emailProvider = await createEmailProvider({
        emailAccountId,
        provider,
        logger,
      });

      await emailProvider.bulkTrashFromSenders(
        froms,
        emailAccount.email,
        emailAccountId,
      );
    },
  );
