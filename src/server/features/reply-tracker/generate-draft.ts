import type { ParsedMessage } from "@/server/lib/types";
import { escapeHtml } from "@/server/lib/string";
import { internalDateToDate } from "@/server/lib/date";
import { getEmailForLLM } from "@/server/lib/get-email-from-message";
import { extractEmailAddress, extractEmailAddresses } from "@/server/lib/email";
import { aiDraftReply } from "@/features/reply-tracker/ai/draft-reply";
import { getReply, saveReply } from "@/server/lib/redis/reply";
import { getWritingStyle } from "@/server/lib/user/get";
import type { EmailAccountWithAI } from "@/server/lib/llms/types";
import type { Logger } from "@/server/lib/logger";
import prisma from "@/server/db/client";
import { Prisma, type Knowledge } from "@/generated/prisma/client";
import { aiExtractRelevantKnowledge } from "@/features/knowledge/ai/extract";
import { stringifyEmail } from "@/server/lib/stringify-email";
import { aiExtractFromEmailHistory } from "@/features/knowledge/ai/extract-from-email-history";
import type { EmailProvider } from "@/features/email/types";
import { aiCollectReplyContext } from "@/features/reply-tracker/ai/reply-context-collector";
import { aiGetCalendarAvailability } from "@/features/calendar/ai/availability";
import {
  getMeetingContext,
  formatMeetingContextForPrompt,
} from "@/features/meeting-briefs/recipient-context";

const KNOWLEDGE_REQUIRED_COLUMNS = ["id", "title", "content", "userId"] as const;

function buildKnowledgeProjection(columns: Set<string>): Prisma.Sql {
  const createdAtExpr = columns.has("createdAt")
    ? Prisma.sql`k."createdAt"`
    : Prisma.sql`NOW()`;
  const updatedAtExpr = columns.has("updatedAt")
    ? Prisma.sql`k."updatedAt"`
    : columns.has("createdAt")
      ? Prisma.sql`k."createdAt"`
      : Prisma.sql`NOW()`;
  const emailAccountIdExpr = columns.has("emailAccountId")
    ? Prisma.sql`k."emailAccountId"`
    : Prisma.sql`NULL::text`;

  return Prisma.sql`
    k.id,
    k.title,
    k.content,
    k."userId",
    ${createdAtExpr} AS "createdAt",
    ${updatedAtExpr} AS "updatedAt",
    ${emailAccountIdExpr} AS "emailAccountId"
  `;
}

async function loadKnowledgeBaseForDraft(params: {
  userId: string;
  logger: Logger;
}): Promise<Knowledge[]> {
  try {
    const columns = await prisma.$queryRaw<Array<{ column_name: string }>>`
      SELECT column_name
      FROM information_schema.columns
      WHERE table_schema = 'public'
        AND table_name = 'Knowledge'
    `;
    const columnSet = new Set(
      columns
        .map((row) => row.column_name)
        .filter((column): column is string => typeof column === "string" && column.length > 0),
    );
    const missingRequired = KNOWLEDGE_REQUIRED_COLUMNS.filter(
      (column) => !columnSet.has(column),
    );
    if (missingRequired.length > 0) {
      params.logger.warn("Draft generation knowledge lookup disabled: required columns missing", {
        missingRequired,
      });
      return [];
    }

    const projection = buildKnowledgeProjection(columnSet);
    const orderByClause = columnSet.has("updatedAt")
      ? Prisma.sql`ORDER BY k."updatedAt" DESC`
      : Prisma.sql`ORDER BY k.id DESC`;

    return await prisma.$queryRaw<Array<Knowledge>>(Prisma.sql`
      SELECT ${projection}
      FROM "Knowledge" k
      WHERE k."userId" = ${params.userId}
      ${orderByClause}
    `);
  } catch (error) {
    params.logger.warn("Draft generation knowledge lookup failed", {
      error: error instanceof Error ? error.message : String(error),
    });
    return [];
  }
}

/**
 * Fetches thread messages and generates draft content in one step
 */
export async function fetchMessagesAndGenerateDraft(
  emailAccount: EmailAccountWithAI,
  threadId: string,
  client: EmailProvider,
  testMessage: ParsedMessage | undefined,
  logger: Logger,
): Promise<string> {
  const { threadMessages, previousConversationMessages } = testMessage
    ? { threadMessages: [testMessage], previousConversationMessages: null }
    : await fetchThreadAndConversationMessages(threadId, client);

  const result = await generateDraftContent(
    emailAccount,
    threadMessages,
    previousConversationMessages,
    client,
    logger,
  );

  if (typeof result !== "string") {
    throw new Error("Draft result is not a string");
  }

  const emailAccountWithSignatures = await prisma.emailAccount.findUnique({
    where: { id: emailAccount.id },
    select: {
      includeReferralSignature: true,
      signature: true,
    },
  });

  // Escape AI-generated content to prevent prompt injection attacks
  // (e.g., hidden divs with sensitive data that could be leaked)
  // Signatures and other trusted HTML are added AFTER escaping
  let finalResult = escapeHtml(result);

  if (emailAccountWithSignatures?.includeReferralSignature) {
    finalResult = `${finalResult}\n\nDrafted by Amodel.`;
  }

  if (emailAccountWithSignatures?.signature) {
    finalResult = `${finalResult}\n\n${emailAccountWithSignatures.signature}`;
  }

  return finalResult;
}

/**
 * Fetches thread messages and previous conversation messages
 */
async function fetchThreadAndConversationMessages(
  threadId: string,
  client: EmailProvider,
): Promise<{
  threadMessages: ParsedMessage[];
  previousConversationMessages: ParsedMessage[] | null;
}> {
  const threadMessages = await client.getThreadMessages(threadId);
  const previousConversationMessages =
    await client.getPreviousConversationMessages(
      threadMessages.map((msg) => msg.id),
    );

  return {
    threadMessages,
    previousConversationMessages,
  };
}

async function generateDraftContent(
  emailAccount: EmailAccountWithAI,
  threadMessages: ParsedMessage[],
  previousConversationMessages: ParsedMessage[] | null,
  emailProvider: EmailProvider,
  logger: Logger,
) {
  const lastMessage = threadMessages.at(-1);

  if (!lastMessage) throw new Error("No message provided");

  // Check Redis cache for reply
  const reply = await getReply({
    emailAccountId: emailAccount.id,
    messageId: lastMessage.id,
  });

  if (reply) return reply;

  const messages = threadMessages.map((msg, index) => ({
    date: internalDateToDate(msg.internalDate),
    ...getEmailForLLM(msg, {
      // give more context for the message we're processing
      maxLength: index === threadMessages.length - 1 ? 2000 : 500,
      extractReply: true,
      removeForwarded: false,
    }),
  }));

  // 1. Get knowledge base entries
  const knowledgeBase = await loadKnowledgeBaseForDraft({
    userId: emailAccount.userId,
    logger,
  });

  // If we have knowledge base entries, extract relevant knowledge and draft with it
  // 2a. Extract relevant knowledge
  const lastMessageContent = stringifyEmail(
    messages[messages.length - 1],
    10_000,
  );
  const [
    knowledgeResult,
    emailHistoryContext,
    calendarAvailability,
    writingStyle,
    upcomingMeetings,
  ] = await Promise.all([
    aiExtractRelevantKnowledge({
      knowledgeBase,
      emailContent: lastMessageContent,
      emailAccount,
      logger,
    }),
    aiCollectReplyContext({
      currentThread: messages,
      emailAccount,
      emailProvider,
    }),
    aiGetCalendarAvailability({ emailAccount, messages, logger }),
    getWritingStyle({ emailAccountId: emailAccount.id }),
    getMeetingContext({
      emailAccountId: emailAccount.id,
      recipientEmail: extractEmailAddress(lastMessage.headers.from),
      // extract all other recipients (To, CC) for privacy filtering
      // only meetings where ALL recipients were attendees will be included
      additionalRecipients: [
        ...extractEmailAddresses(lastMessage.headers.to),
        ...extractEmailAddresses(lastMessage.headers.cc ?? ""),
      ].filter(
        (email) => email.toLowerCase() !== emailAccount.email.toLowerCase(),
      ),
      logger,
    }),
  ]);

  // 2b. Extract email history context
  const senderEmail = lastMessage.headers.from;

  logger.info("Fetching historical messages from sender", {
    sender: senderEmail,
  });

  // Convert to format needed for aiExtractFromEmailHistory
  const historicalMessagesForLLM = previousConversationMessages?.map((msg) => {
    return getEmailForLLM(msg, {
      maxLength: 1000,
      extractReply: true,
      removeForwarded: false,
    });
  });

  const emailHistorySummary = historicalMessagesForLLM?.length
    ? await aiExtractFromEmailHistory({
        currentThreadMessages: messages,
        historicalMessages: historicalMessagesForLLM,
        emailAccount,
        logger,
      })
    : null;

  // 3. Draft reply
  const text = await aiDraftReply({
    messages,
    emailAccount,
    knowledgeBaseContent: knowledgeResult?.relevantContent || null,
    emailHistorySummary,
    emailHistoryContext,
    calendarAvailability,
    writingStyle,
    meetingContext: formatMeetingContextForPrompt(
      upcomingMeetings,
      emailAccount.timezone,
    ),
  });

  if (typeof text === "string") {
    await saveReply({
      emailAccountId: emailAccount.id,
      messageId: lastMessage.id,
      reply: text,
    });
  }

  return text;
}
