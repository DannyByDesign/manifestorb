import uniq from "lodash/uniq";
import countBy from "lodash/countBy";
import type { EmailProvider } from "@/features/email/types";
import { GmailProvider } from "@/features/email/providers/google";
import { getEmailClient } from "@/server/lib/mail";
import { isDefined } from "@/server/lib/types";
import type { Logger } from "@/server/lib/logger";
import { GmailLabel } from "@/server/integrations/google/label";
import { getFilters, getForwardingAddresses } from "@/server/integrations/google/settings";
import type { gmail_v1 } from "@googleapis/gmail";

function getGmailApiClient(provider: EmailProvider): gmail_v1.Gmail | null {
  if (!(provider instanceof GmailProvider)) return null;
  const client = (provider as unknown as { client?: gmail_v1.Gmail }).client;
  return client ?? null;
}

export async function assessUser({
  client,
  logger,
}: {
  client: EmailProvider;
  logger: Logger;
}) {
  // how many unread emails?
  const unreadCount = await getUnreadEmailCount(client);
  // how many unarchived emails?
  const inboxCount = await getInboxCount(client);
  // how many sent emails?
  const sentCount = await getSentCount(client);

  // does user make use of labels?
  const labelCount = await getLabelCount(client);

  // does user have any filters?
  const filtersCount = await getFiltersCount(client);

  // does user have any auto-forwarding rules?
  // TODO

  // does user forward emails to other accounts?
  const forwardingAddressesCount = await getForwardingAddressesCount(
    client,
    logger,
  );

  // does user use snippets?
  // Gmail API doesn't provide a way to check this
  // TODO We could check it with embeddings

  // what email client does user use?
  const emailClients = await getEmailClients(client, logger);

  return {
    unreadCount,
    inboxCount,
    sentCount,
    labelCount,
    filtersCount,
    forwardingAddressesCount,
    emailClients,
  };
}

async function getUnreadEmailCount(client: EmailProvider) {
  const label = await client.getLabelById(GmailLabel.UNREAD);
  return label?.threadsTotal || 0;
}

export async function getInboxCount(client: EmailProvider) {
  const label = await client.getLabelById(GmailLabel.INBOX);
  return label?.threadsTotal || 0;
}

export async function getUnreadCount(client: EmailProvider) {
  const label = await client.getLabelById(GmailLabel.UNREAD);
  return label?.threadsTotal || 0;
}

async function getSentCount(client: EmailProvider) {
  const label = await client.getLabelById(GmailLabel.SENT);
  return label?.threadsTotal || 0;
}

async function getLabelCount(client: EmailProvider) {
  const labels = await client.getLabels();
  const DEFAULT_LABEL_COUNT = 13;
  return labels.length - DEFAULT_LABEL_COUNT;
}

async function getFiltersCount(client: EmailProvider) {
  const gmail = getGmailApiClient(client);
  if (gmail) {
    const filters = await getFilters(gmail);
    return filters.length;
  }
  return 0;
}

async function getForwardingAddressesCount(
  client: EmailProvider,
  logger: Logger,
) {
  if (client instanceof GmailProvider) {
    try {
      const gmail = getGmailApiClient(client);
      if (!gmail) return 0;
      const forwardingAddresses = await getForwardingAddresses(gmail);
      return forwardingAddresses.length;
    } catch (error) {
      // Can happen due to "Forwarding features disabled by administrator"
      logger.error("Error getting forwarding addresses", { error });
      return 0;
    }
  }
  // Outlook doesn't have a direct equivalent to Gmail forwarding
  return 0;
}

async function getEmailClients(client: EmailProvider, logger: Logger) {
  try {
    const messages = await client.getSentMessages(50);

    // go through the messages, and check the headers for the email client
    const clients = messages
      .filter((message) => message.headers["message-id"])
      .map((message) => {
        const messageId = message.headers["message-id"];
        return messageId ? getEmailClient(messageId) : undefined;
      })
      .filter(isDefined);

    const counts = countBy(clients);
    const mostPopular = Object.entries(counts).sort((a, b) => b[1] - a[1]);

    return { clients: uniq(clients), primary: mostPopular[0]?.[0] };
  } catch (error) {
    logger.error("Error getting email clients", { error });
    return { clients: [], primary: undefined };
  }
}

export async function getUnhandledCount(client: EmailProvider): Promise<{
  unhandledCount: number;
  type: "inbox" | "unread";
}> {
  const [inboxCount, unreadCount] = await Promise.all([
    getInboxCount(client),
    getUnreadCount(client),
  ]);
  const unhandledCount = Math.min(unreadCount, inboxCount);
  return {
    unhandledCount,
    type: unhandledCount === inboxCount ? "inbox" : "unread",
  };
}
