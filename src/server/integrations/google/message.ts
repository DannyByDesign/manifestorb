import type { gmail_v1 } from "@googleapis/gmail";
import { createHash } from "crypto";
import PQueue from "p-queue";
import {
  type BatchError,
  type MessageWithPayload,
  type ParsedMessage,
  type ThreadWithPayloadMessages,
  isBatchError,
  isDefined,
} from "@/server/types";
import { getBatch } from "@/server/integrations/google/batch";
import { getSearchTermForSender } from "@/server/lib/email";
import { createScopedLogger } from "@/server/lib/logger";
import { sleep } from "@/server/lib/sleep";
import { getAccessTokenFromClient } from "@/server/integrations/google/client";
import { GmailLabel } from "@/server/integrations/google/label";
import { isIgnoredSender } from "@/server/lib/filter-ignored-senders";
import parse from "gmail-api-parse-message";
import { isRetryableError, withGmailRetry } from "@/server/integrations/google/retry";

const logger = createScopedLogger("gmail/message");
const MESSAGE_BATCH_CONCURRENCY_PER_USER = 1;
const MESSAGE_BATCH_QUEUE_TTL_MS = 10 * 60 * 1000;
const messageBatchQueues = new Map<
  string,
  { queue: PQueue; touchedAt: number }
>();

function getMessageBatchQueue(accessToken: string): PQueue {
  const key = createHash("sha256")
    .update(accessToken)
    .digest("hex")
    .slice(0, 16);
  const now = Date.now();
  for (const [queueKey, entry] of messageBatchQueues.entries()) {
    if (now - entry.touchedAt > MESSAGE_BATCH_QUEUE_TTL_MS) {
      messageBatchQueues.delete(queueKey);
    }
  }
  const existing = messageBatchQueues.get(key);
  if (existing) {
    existing.touchedAt = now;
    return existing.queue;
  }
  const queue = new PQueue({ concurrency: MESSAGE_BATCH_CONCURRENCY_PER_USER });
  messageBatchQueues.set(key, { queue, touchedAt: now });
  return queue;
}

export function parseMessage(
  message: MessageWithPayload,
): ParsedMessage & { subject: string; date: string } {
  const parsed = parse(message) as ParsedMessage;
  return {
    ...parsed,
    subject: parsed.headers?.subject || "",
    date: parsed.headers?.date || "",
    // gmail-api-parse-message converts internalDate to a number, but our type expects string
    internalDate:
      parsed.internalDate != null ? String(parsed.internalDate) : null,
  };
}

export function parseMessages(
  thread: ThreadWithPayloadMessages,
  {
    withoutIgnoredSenders,
    withoutDrafts,
  }: {
    withoutIgnoredSenders?: boolean;
    withoutDrafts?: boolean;
  } = {},
) {
  const messages =
    thread.messages?.map((message: MessageWithPayload) => {
      return parseMessage(message);
    }) || [];

  if (withoutIgnoredSenders || withoutDrafts) {
    const filteredMessages = messages.filter((message) => {
      if (
        withoutIgnoredSenders &&
        message.headers &&
        isIgnoredSender(message.headers.from)
      )
        return false;
      if (withoutDrafts && message.labelIds?.includes(GmailLabel.DRAFT))
        return false;
      return true;
    });
    return filteredMessages;
  }

  return messages;
}

export async function getMessage(
  messageId: string,
  gmail: gmail_v1.Gmail,
  format?: "full" | "metadata",
): Promise<MessageWithPayload> {
  return withGmailRetry(async () => {
    const message = await gmail.users.messages.get({
      userId: "me",
      id: messageId,
      format,
    });

    return message.data as MessageWithPayload;
  });
}

export async function getMessageByRfc822Id(
  rfc822MessageId: string,
  gmail: gmail_v1.Gmail,
) {
  // Search for message using RFC822 Message-ID header
  // Remove any < > brackets if present
  const cleanMessageId = rfc822MessageId.replace(/[<>]/g, "");

  const response = await withGmailRetry(() =>
    gmail.users.messages.list({
      userId: "me",
      q: `rfc822msgid:${cleanMessageId}`,
      maxResults: 1,
    }),
  );

  const message = response.data.messages?.[0];
  if (!message?.id) {
    logger.error("No message found for RFC822 Message-ID", {
      rfc822MessageId,
    });
    return null;
  }

  return getMessage(message.id, gmail);
}

export async function getMessagesBatch({
  messageIds,
  accessToken,
  retryCount = 0,
}: {
  messageIds: string[];
  accessToken: string;
  retryCount?: number;
}): Promise<ParsedMessage[]> {
  if (!accessToken) throw new Error("No access token");

  if (retryCount > 3) {
    logger.error("Too many retries", { messageIds, retryCount });
    return [];
  }
  if (messageIds.length > 100) throw new Error("Too many messages. Max 100");

  const batchQueue = getMessageBatchQueue(accessToken);
  const BATCH_CHUNK_SIZE = 10;
  const batchedResults: Array<{
    messageId: string;
    result: MessageWithPayload | BatchError;
  }> = [];
  for (let i = 0; i < messageIds.length; i += BATCH_CHUNK_SIZE) {
    const chunkIds = messageIds.slice(i, i + BATCH_CHUNK_SIZE);
    const chunkBatch = (await batchQueue.add(() =>
      getBatch(
        chunkIds,
        "/gmail/v1/users/me/messages",
        accessToken,
      ),
    )) as (MessageWithPayload | BatchError)[];

    for (let index = 0; index < chunkBatch.length; index += 1) {
      const messageId = chunkIds[index];
      if (!messageId) continue;
      batchedResults.push({
        messageId,
        result: chunkBatch[index],
      });
    }
  }

  const missingMessageIds = new Set<string>();

  if (batchedResults.some((entry) => isBatchError(entry.result) && entry.result.error.code === 401)) {
    logger.error("Error fetching messages", { firstBatchItem: batchedResults?.[0]?.result });
    throw new Error("Invalid access token");
  }

  const messages = batchedResults
    .map((entry) => {
      const message = entry.result;
      if (isBatchError(message)) {
        const { code, message: errorMessage, errors } = message.error;
        const flattenedErrors = Array.isArray(errors)
          ? (errors.flat() as unknown[])
          : [];
        const firstErrorWithReason = flattenedErrors.find((value) => {
          return (
            value &&
            typeof value === "object" &&
            "reason" in value &&
            typeof (value as { reason?: unknown }).reason === "string"
          );
        }) as { reason: string } | undefined;
        const reason = firstErrorWithReason?.reason;

        const { retryable } = isRetryableError({
          status: code,
          reason,
          errorMessage,
        });

        if (!retryable) {
          logger.warn("Skipping message due to non-retryable error", {
            messageId: entry.messageId,
            code,
            reason,
            errorMessage,
          });
          return;
        }

        logger.error("Error fetching message, adding to retry queue", {
          messageId: entry.messageId,
          code,
          error: errorMessage,
          reason,
        });
        missingMessageIds.add(entry.messageId);
        return;
      }

      return parseMessage(message as MessageWithPayload);
    })
    .filter(isDefined);

  // if we errored, then try to refetch the missing messages
  if (missingMessageIds.size > 0) {
    logger.info("Missing messages", {
      missingMessageIds: Array.from(missingMessageIds),
    });
    const nextRetryCount = retryCount + 1;
    const baseDelayMs = 1000 * nextRetryCount;
    const jitterMs = Math.floor(Math.random() * 750);
    await sleep(baseDelayMs + jitterMs);
    const missingMessages = await getMessagesBatch({
      messageIds: Array.from(missingMessageIds),
      accessToken,
      retryCount: nextRetryCount,
    });
    return [...messages, ...missingMessages];
  }

  return messages;
}

async function findPreviousEmailsWithSender(
  gmail: gmail_v1.Gmail,
  options: {
    sender: string;
    dateInSeconds: number;
  },
) {
  const beforeTimestamp = Math.floor(options.dateInSeconds);
  const query = `(from:${options.sender} OR to:${options.sender}) before:${beforeTimestamp}`;

  const response = await getMessages(gmail, {
    query,
    maxResults: 4,
  });

  return response.messages || [];
}

async function hasPreviousCommunicationWithSender(
  gmail: gmail_v1.Gmail,
  options: { from: string; date: Date; messageId: string },
) {
  const previousEmails = await findPreviousEmailsWithSender(gmail, {
    sender: options.from,
    dateInSeconds: +new Date(options.date) / 1000,
  });
  // Ignore the current email
  const hasPreviousEmail = !!previousEmails?.find(
    (p) => p.id !== options.messageId,
  );

  return hasPreviousEmail;
}

export async function hasPreviousCommunicationsWithSenderOrDomain(
  gmail: gmail_v1.Gmail,
  options: { from: string; date: Date; messageId: string },
) {
  const searchTerm = getSearchTermForSender(options.from);

  return hasPreviousCommunicationWithSender(gmail, {
    ...options,
    from: searchTerm,
  });
}

// List of messages.
// Note that each message resource contains only an id and a threadId.
// Additional message details can be fetched using the messages.get method.
// https://developers.google.com/workspace/gmail/api/reference/rest/v1/users.messages/list
export async function getMessages(
  gmail: gmail_v1.Gmail,
  options: {
    query?: string;
    maxResults?: number;
    pageToken?: string;
    labelIds?: string[];
  },
): Promise<{
  messages: {
    id: string;
    threadId: string;
  }[];
  nextPageToken?: string;
  resultSizeEstimate?: number;
}> {
  const messages = await withGmailRetry(() =>
    gmail.users.messages.list({
      userId: "me",
      maxResults: options.maxResults,
      q: options.query,
      pageToken: options.pageToken,
      labelIds: options.labelIds,
    }),
  );

  return {
    messages: messages.data.messages?.filter(isMessage) || [],
    nextPageToken: messages.data.nextPageToken || undefined,
    resultSizeEstimate: messages.data.resultSizeEstimate ?? undefined,
  };
}

function isMessage(
  message: gmail_v1.Schema$Message,
): message is { id: string; threadId: string } {
  return !!message.id && !!message.threadId;
}

export async function queryBatchMessages(
  gmail: gmail_v1.Gmail,
  options: {
    query?: string;
    maxResults?: number;
    pageToken?: string;
  },
) {
  const { query, pageToken } = options;

  const MAX_RESULTS = 20;

  const maxResults = Math.min(options.maxResults || MAX_RESULTS, MAX_RESULTS);

  if (options.maxResults && options.maxResults > MAX_RESULTS) {
    logger.warn(
      "Max results is greater than 20, which will cause rate limiting",
      {
        maxResults,
      },
    );
  }

  const accessToken = getAccessTokenFromClient(gmail);

  const messages = await getMessages(gmail, { query, maxResults, pageToken });
  if (!messages.messages) return { messages: [], nextPageToken: undefined };
  const messageIds = messages.messages.map((m) => m.id).filter(isDefined);
  return {
    messages: (await getMessagesBatch({ messageIds, accessToken })) || [],
    nextPageToken: messages.nextPageToken,
  };
}

// loops through multiple pages of messages
export async function queryBatchMessagesPages(
  gmail: gmail_v1.Gmail,
  {
    query,
    maxResults,
  }: {
    query: string;
    maxResults: number;
  },
) {
  const messages: ParsedMessage[] = [];
  let nextPageToken: string | undefined;
  do {
    const { messages: pageMessages, nextPageToken: nextToken } =
      await queryBatchMessages(gmail, {
        query,
        pageToken: nextPageToken,
      });
    messages.push(...pageMessages);
    nextPageToken = nextToken || undefined;
  } while (nextPageToken && messages.length < maxResults);

  return messages;
}

export async function getSentMessages(gmail: gmail_v1.Gmail, maxResults = 20) {
  const messages = await queryBatchMessages(gmail, {
    query: "label:sent",
    maxResults,
  });
  return messages.messages;
}
