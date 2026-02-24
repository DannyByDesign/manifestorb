import uniqBy from "lodash/uniqBy";
import { NextResponse } from "next/server";
import * as Sentry from "@sentry/nextjs";
import { getGmailClientWithRefresh } from "@/server/integrations/google/client";
import { GmailLabel } from "@/server/integrations/google/label";
import { captureException } from "@/server/lib/error";
import {
  HistoryEventType,
  type ProcessHistoryOptions,
} from "@/app/api/google/webhook/types";
import { processHistoryItem } from "@/app/api/google/webhook/process-history-item";
import { getHistory } from "@/server/integrations/google/history";
import {
  validateWebhookAccount,
  getWebhookEmailAccount,
  type ValidatedWebhookAccountData,
} from "@/features/webhooks/validate-webhook-account";
import prisma from "@/server/db/client";
import type { Logger } from "@/server/lib/logger";
import type { gmail_v1 } from "@googleapis/gmail";

function normalizeHistoryId(value: unknown): string | null {
  if (typeof value === "number") {
    if (!Number.isFinite(value) || value <= 0) return null;
    return Math.trunc(value).toString();
  }
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!/^\d+$/u.test(trimmed)) return null;
  const normalized = trimmed.replace(/^0+/u, "");
  return normalized.length > 0 ? normalized : null;
}

export async function processHistoryForUser(
  decodedData: {
    emailAddress: string;
    historyId: number | string;
  },
  options: { startHistoryId?: string },
  logger: Logger,
) {
  const startTime = Date.now();
  const { emailAddress, historyId } = decodedData;
  const webhookHistoryId = normalizeHistoryId(historyId);
  // All emails in the database are stored in lowercase
  // But it's possible that the email address in the webhook is not
  // So we need to convert it to lowercase
  const email = emailAddress.toLowerCase();

  if (!webhookHistoryId) {
    logger.warn("Invalid Gmail webhook history ID; skipping", { historyId });
    return NextResponse.json({ ok: true });
  }

  const emailAccount = await getWebhookEmailAccount({ email }, logger);

  // biome-ignore lint/style/noParameterAssign: allowed for logging
  logger = logger.with({ email, emailAccountId: emailAccount?.id });

  const validation = await validateWebhookAccount(emailAccount, logger);

  if (!validation.success) {
    return validation.response;
  }

  const {
    emailAccount: validatedEmailAccount,
    hasAutomationRules,
    hasAiAccess: userHasAiAccess,
  } = validation.data;

  Sentry.setTag("emailAccountId", validatedEmailAccount.id);
  Sentry.setUser({
    id: validatedEmailAccount.userId,
    email: validatedEmailAccount.email,
  });

  if (
    !validatedEmailAccount.account?.access_token ||
    !validatedEmailAccount.account?.refresh_token
  ) {
    logger.error("Missing tokens after validation");
    return NextResponse.json({ error: true });
  }

  const accountAccessToken = validatedEmailAccount.account.access_token;
  const accountRefreshToken = validatedEmailAccount.account.refresh_token;
  const accountProvider = validatedEmailAccount.account.provider || "google";

  try {
    const gmail = await getGmailClientWithRefresh({
      accessToken: accountAccessToken,
      refreshToken: accountRefreshToken,
      expiresAt: validatedEmailAccount.account.expires_at?.getTime() || null,
      emailAccountId: validatedEmailAccount.id,
      logger,
    });

    const historyResult = await fetchGmailHistoryResilient({
      gmail,
      emailAccount,
      webhookHistoryId,
      options,
      logger,
    });

    if (historyResult.status === "expired") {
      const backfill = await runFullBackfillFromMailboxState({
        gmail,
        options: {
          emailAccount: {
            ...validatedEmailAccount,
            account: {
              provider: accountProvider,
            },
          },
          history: [],
          accessToken: accountAccessToken,
          hasAutomationRules,
          hasAiAccess: userHasAiAccess,
          gmail,
        },
        logger,
      });
      if (backfill.completed && backfill.latestHistoryId) {
        await updateLastSyncedHistoryId({
          emailAccountId: validatedEmailAccount.id,
          lastSyncedHistoryId: backfill.latestHistoryId,
        });
      }
      return NextResponse.json({ ok: true });
    }

    const history = historyResult.data;

    if (history.history) {
      logger.info("Processing history", {
        startHistoryId: historyResult.startHistoryId,
      });

      await processHistory(
        {
          history: history.history,
          gmail,
          accessToken: accountAccessToken,
          hasAutomationRules,
          hasAiAccess: userHasAiAccess,
          emailAccount: {
            ...validatedEmailAccount,
            account: {
              provider: accountProvider,
            },
          },
        },
        logger,
      );
      await updateLastSyncedHistoryId({
        emailAccountId: validatedEmailAccount.id,
        lastSyncedHistoryId: historyResult.latestHistoryId,
      });
    } else {
      logger.info("No history", {
        startHistoryId: historyResult.startHistoryId,
      });

      // important to save this or we can get into a loop with never receiving history
      await updateLastSyncedHistoryId({
        emailAccountId: validatedEmailAccount.id,
        lastSyncedHistoryId: webhookHistoryId,
      });
    }

    const processingTimeMs = Date.now() - startTime;
    logger.info("Completed processing history", { processingTimeMs });

    return NextResponse.json({ ok: true });
  } catch (error) {
    if (error instanceof Error && error.message === "invalid_grant") {
      logger.warn("Invalid grant", { email });
      return NextResponse.json({ ok: true });
    }

    captureException(error, { userEmail: email, extra: { decodedData } });
    logger.error("Error processing webhook", {
      error:
        error instanceof Error
          ? {
              message: error.message,
              stack: error.stack,
              name: error.name,
            }
          : error,
    });
    // returning 200 here, as otherwise PubSub will call the webhook over and over
    return NextResponse.json({ error: true });
  }
}

async function processHistory(options: ProcessHistoryOptions, logger: Logger) {
  const { history, emailAccount } = options;
  const { email: userEmail, id: emailAccountId } = emailAccount;

  if (!history?.length) return;

  for (const h of history) {
    const historyMessages = [
      ...(h.messagesAdded || []),
      ...(h.labelsAdded || []),
      ...(h.labelsRemoved || []),
    ];

    if (!historyMessages.length) continue;

    const allEvents = [
      ...(h.messagesAdded || [])
        .filter((m) => {
          const isRelevant = isInboxOrSentMessage(m);
          if (!isRelevant) {
            logger.info("Skipping message not in inbox or sent", {
              messageId: m.message?.id,
              labelIds: m.message?.labelIds,
            });
          }
          return isRelevant;
        })
        .map((m) => ({ type: HistoryEventType.MESSAGE_ADDED, item: m })),
      ...(h.labelsAdded || []).map((m) => ({
        type: HistoryEventType.LABEL_ADDED,
        item: m,
      })),
      ...(h.labelsRemoved || []).map((m) => ({
        type: HistoryEventType.LABEL_REMOVED,
        item: m,
      })),
    ];

    const uniqueEvents = uniqBy(
      allEvents,
      (e) => `${e.type}:${e.item.message?.id}`,
    );

    for (const event of uniqueEvents) {
      const log = logger.with({
        messageId: event.item.message?.id,
        threadId: event.item.message?.threadId,
      });

      try {
        await processHistoryItem(event, options, log);
      } catch (error) {
        captureException(error, {
          userEmail,
          extra: { messageId: event.item.message?.id },
        });
        logger.error("Error processing history item", { error });
      }
    }
  }

  const lastSyncedHistoryId = history[history.length - 1].id;

  await updateLastSyncedHistoryId({
    emailAccountId,
    lastSyncedHistoryId,
  });
}

async function runFullBackfillFromMailboxState(params: {
  gmail: gmail_v1.Gmail;
  options: ProcessHistoryOptions;
  logger: Logger;
}): Promise<{ completed: boolean; latestHistoryId?: string }> {
  const { gmail, options, logger } = params;
  const usersApi = gmail.users;
  if (!usersApi?.getProfile || !usersApi.messages?.list) {
    logger.warn("Backfill unavailable: Gmail profile/messages API missing");
    return { completed: false };
  }

  const profile = await usersApi.getProfile({ userId: "me" });
  const latestHistoryId = normalizeHistoryId(profile.data.historyId);
  if (!latestHistoryId) {
    logger.warn("Backfill unavailable: Gmail profile returned no historyId");
    return { completed: false };
  }

  const seenMessageIds = new Set<string>();
  let pageToken: string | undefined;
  let processed = 0;

  do {
    const response = await usersApi.messages.list({
      userId: "me",
      maxResults: 500,
      pageToken,
      includeSpamTrash: false,
    });

    const messages = response.data.messages ?? [];
    for (const message of messages) {
      const messageId = message.id ?? "";
      const threadId = message.threadId ?? "";
      if (!messageId || !threadId || seenMessageIds.has(messageId)) continue;
      seenMessageIds.add(messageId);

      await processHistoryItem(
        {
          type: HistoryEventType.MESSAGE_ADDED,
          item: {
            message: {
              id: messageId,
              threadId,
              labelIds: [GmailLabel.INBOX],
            },
          },
        },
        options,
        logger.with({ backfillMessageId: messageId, backfillThreadId: threadId }),
      );
      processed += 1;
    }

    pageToken = response.data.nextPageToken ?? undefined;
  } while (pageToken);

  logger.info("Completed Gmail full backfill after expired history id", {
    processedCount: processed,
    latestHistoryId,
  });
  return {
    completed: true,
    latestHistoryId,
  };
}

/**
 * Updates lastSyncedHistoryId using a monotonic/conditional update to prevent
 * race conditions where concurrent webhook processors might regress the pointer.
 * Only updates if the new value is greater than the current value.
 */
async function updateLastSyncedHistoryId({
  emailAccountId,
  lastSyncedHistoryId,
}: {
  emailAccountId: string;
  lastSyncedHistoryId?: string | null;
}) {
  const normalizedHistoryId = normalizeHistoryId(lastSyncedHistoryId);
  if (!normalizedHistoryId) return;

  // Use conditional update: only set if new value > current value (or current is null)
  // This prevents race conditions where slower webhook processors with older
  // history IDs could overwrite progress from faster processors with newer IDs
  await prisma.$executeRaw`
    UPDATE "EmailAccount"
    SET "lastSyncedHistoryId" = ${normalizedHistoryId}, "updatedAt" = NOW()
    WHERE id = ${emailAccountId}
    AND (
      "lastSyncedHistoryId" IS NULL
      OR CAST("lastSyncedHistoryId" AS NUMERIC) < CAST(${normalizedHistoryId} AS NUMERIC)
    )
  `;
}

const isInboxOrSentMessage = (message: {
  message?: { labelIds?: string[] | null };
}) => {
  const labels = message.message?.labelIds;

  if (!labels) return false;

  if (labels.includes(GmailLabel.INBOX) && !labels.includes(GmailLabel.DRAFT))
    return true;

  if (labels.includes(GmailLabel.SENT)) return true;

  return false;
};

function isHistoryIdExpiredError(error: unknown): boolean {
  type HistoryErrorShape = {
    response?: { data?: { error?: { code?: unknown } }; status?: unknown };
    status?: unknown;
    code?: unknown;
  };
  const err = error as HistoryErrorShape;
  const statusCode =
    err.response?.data?.error?.code ??
    err.response?.status ??
    err.status ??
    err.code;

  return statusCode === 404 || statusCode === "404";
}

/**
 * Fetches history from Gmail with resilience:
 * 1. Starts from a persisted sync point (or current webhook history ID if unset).
 * 2. Paginates through all Gmail history pages.
 * 3. Handles expired history IDs (404s) by resetting the sync point.
 */
async function fetchGmailHistoryResilient({
  gmail,
  emailAccount,
  webhookHistoryId,
  options,
  logger,
}: {
  gmail: gmail_v1.Gmail;
  emailAccount: ValidatedWebhookAccountData;
  webhookHistoryId: string;
  options: { startHistoryId?: string };
  logger: Logger;
}): Promise<
  | {
      status: "success";
      data: Awaited<ReturnType<typeof getHistory>>;
      startHistoryId: string;
      latestHistoryId?: string;
    }
  | { status: "expired" }
> {
  const startHistoryId =
    normalizeHistoryId(options?.startHistoryId) ??
    normalizeHistoryId(emailAccount?.lastSyncedHistoryId) ??
    webhookHistoryId;

  logger.info("Listing history", {
    startHistoryId,
    webhookHistoryId,
    lastSyncedHistoryId: emailAccount?.lastSyncedHistoryId,
    gmailHistoryId: startHistoryId,
  });

  try {
    type GmailHistoryResponse = Awaited<ReturnType<typeof getHistory>>;
    const allHistory: NonNullable<GmailHistoryResponse["history"]> = [];
    let nextPageToken: string | undefined;
    let latestHistoryId: string | undefined;
    let lastPage: GmailHistoryResponse | null = null;
    let pageCount = 0;

    do {
      const data = await getHistory(gmail, {
        startHistoryId,
        historyTypes: ["messageAdded", "labelAdded", "labelRemoved"],
        maxResults: 500,
        pageToken: nextPageToken,
      });
      pageCount += 1;
      lastPage = data;
      if (Array.isArray(data.history)) {
        allHistory.push(...data.history);
      }
      if (typeof data.historyId === "string" && data.historyId.trim().length > 0) {
        latestHistoryId = data.historyId;
      }
      nextPageToken = data.nextPageToken ?? undefined;
    } while (nextPageToken);

    if (pageCount > 1) {
      logger.info("Fetched paginated Gmail history", {
        startHistoryId,
        pageCount,
        historyItemCount: allHistory.length,
      });
    }

    const data: GmailHistoryResponse = {
      ...(lastPage ?? {}),
      history: allHistory.length > 0 ? allHistory : undefined,
      nextPageToken: undefined,
      historyId: latestHistoryId ?? lastPage?.historyId ?? undefined,
    };
    return {
      status: "success",
      data,
      startHistoryId,
      latestHistoryId:
        latestHistoryId ??
        normalizeHistoryId(lastPage?.historyId) ??
        undefined,
    };
  } catch (error) {
    // Gmail history IDs are typically valid for ~1 week. If older, Gmail returns a 404.
    // In this case, we reset the sync point to the current history ID.
    if (isHistoryIdExpiredError(error)) {
      logger.warn("HistoryId expired, resetting to current", {
        expiredHistoryId: startHistoryId,
        newHistoryId: webhookHistoryId,
      });
      return { status: "expired" };
    }
    throw error;
  }
}
