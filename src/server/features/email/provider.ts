import {
  getGmailClientForEmail,
} from "@/server/lib/account";
import { GmailProvider } from "@/features/email/providers/google";
import {
  isGoogleProvider,
} from "@/features/email/provider-types";
import type { EmailProvider } from "@/features/email/types";
import type { Logger } from "@/server/lib/logger";

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
  }

  throw new Error(`Unsupported provider: ${provider}`);
}
