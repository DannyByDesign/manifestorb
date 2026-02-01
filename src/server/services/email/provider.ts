import {
  getGmailClientForEmail,
  getOutlookClientForEmail,
} from "@/utils/account";
import { GmailProvider } from "@/server/services/email/google";
import { OutlookProvider } from "@/server/services/email/microsoft";
import {
  isGoogleProvider,
  isMicrosoftProvider,
} from "@/server/services/email/provider-types";
import type { EmailProvider } from "@/server/services/email/types";
import type { Logger } from "@/utils/logger";

export async function createEmailProvider({
  emailAccountId,
  provider,
  logger,
}: {
  emailAccountId: string;
  provider: string;
  logger: Logger;
}): Promise<EmailProvider> {
  if (isGoogleProvider(provider)) {
    const client = await getGmailClientForEmail({ emailAccountId, logger });
    return new GmailProvider(client, emailAccountId, logger);
  } else if (isMicrosoftProvider(provider)) {
    const client = await getOutlookClientForEmail({ emailAccountId, logger });
    return new OutlookProvider(client, logger);
  }

  throw new Error(`Unsupported provider: ${provider}`);
}
