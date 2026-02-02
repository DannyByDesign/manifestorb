"use server";

import { env } from "@/env";
import { GmailLabel } from "@/server/integrations/google/label";
import { actionClient } from "@/actions/safe-action";
import { isGoogleProvider } from "@/features/email/provider-types";
import { createEmailProvider } from "@/features/email/provider";

export const whitelistAmodelAction = actionClient
  .metadata({ name: "whitelistAmodel" })
  .action(async ({ ctx: { emailAccountId, provider, logger } }) => {
    if (!env.WHITELIST_FROM) return;
    if (!isGoogleProvider(provider)) return;

    const emailProvider = await createEmailProvider({
      emailAccountId,
      provider,
      logger,
    });

    await emailProvider.createFilter({
      from: env.WHITELIST_FROM,
      addLabelIds: ["CATEGORY_PERSONAL", GmailLabel.IMPORTANT],
      removeLabelIds: [GmailLabel.SPAM],
    });
  });
