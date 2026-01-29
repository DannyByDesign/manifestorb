"use server";

import { env } from "@/env";
import { GmailLabel } from "@/server/integrations/google/label";
import { actionClient } from "@/server/services/unsubscriber/safe-action";
import { isGoogleProvider } from "@/server/integrations/google/provider-types";
import { createEmailProvider } from "@/server/integrations/google/provider";

export const whitelistInboxZeroAction = actionClient
  .metadata({ name: "whitelistInboxZero" })
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
