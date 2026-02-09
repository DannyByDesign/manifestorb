/**
 * Shared helpers for match-rules test files.
 * Used by match-rules.matches-static.test.ts, match-rules.find-matching.test.ts, etc.
 * Mocks (vi.mock) must remain in each test file so they are hoisted correctly.
 */
import { vi } from "vitest";
import { GroupItemType, LogicalOperator } from "@/generated/prisma/enums";
import type { GroupItem, Prisma } from "@/generated/prisma/client";
import type {
  RuleWithActions,
  ParsedMessage,
  ParsedMessageHeaders,
} from "@/server/types";
import type { EmailProvider } from "@/features/email/types";
import prisma from "@/server/lib/__mocks__/prisma";
import { getEmailAccount } from "@/tests/support/helpers";
import { createScopedLogger } from "@/server/lib/logger";

const logger = createScopedLogger("test");

export const provider = {
  isReplyInThread: vi.fn().mockReturnValue(false),
} as unknown as EmailProvider;

export { logger, getEmailAccount, prisma };

export function getStaticRule(
  rule: Partial<Pick<RuleWithActions, "from" | "to" | "subject" | "body">>,
): Pick<RuleWithActions, "from" | "to" | "subject" | "body"> & {
  from: string | null;
  to: string | null;
  subject: string | null;
  body: string | null;
} {
  return {
    from: null,
    to: null,
    subject: null,
    body: null,
    ...rule,
  };
}

export function getRule(overrides: Partial<RuleWithActions> = {}): RuleWithActions {
  const {
    id = "r123",
    createdAt = new Date(),
    updatedAt = new Date(),
    name = "Rule Name",
    enabled = true,
    automate = true,
    runOnThreads = true,
    expiresAt = null,
    isTemporary = false,
    emailAccountId = "emailAccountId",
    conditionalOperator = LogicalOperator.AND,
    instructions = null,
    groupId = null,
    from = null,
    to = null,
    subject = null,
    body = null,
    categoryFilterType = null,
    systemType = null,
    promptText = null,
    actions = [],
  } = overrides;

  return {
    id,
    createdAt,
    updatedAt,
    name,
    enabled,
    automate,
    runOnThreads,
    expiresAt,
    isTemporary,
    emailAccountId,
    conditionalOperator,
    instructions,
    groupId,
    from,
    to,
    subject,
    body,
    categoryFilterType,
    systemType,
    promptText,
    actions,
  };
}

export function getHeaders(
  overrides: Partial<ParsedMessageHeaders> = {},
): ParsedMessageHeaders {
  const {
    subject = "Subject",
    from = "from@example.com",
    to = "to@example.com",
    cc,
    bcc,
    date = new Date().toISOString(),
    "message-id": messageId,
    "reply-to": replyTo,
    "in-reply-to": inReplyTo,
    references,
    "list-unsubscribe": listUnsubscribe,
  } = overrides;

  return {
    subject,
    from,
    to,
    cc,
    bcc,
    date,
    "message-id": messageId,
    "reply-to": replyTo,
    "in-reply-to": inReplyTo,
    references,
    "list-unsubscribe": listUnsubscribe,
  };
}

export function getMessage(overrides: Partial<ParsedMessage> = {}): ParsedMessage {
  const {
    id = "m1",
    threadId = "m1",
    labelIds = [],
    snippet = "snippet",
    historyId = "h1",
    attachments = [],
    inline = [],
    headers = getHeaders(),
    textPlain = "textPlain",
    textHtml = "textHtml",
    subject = "subject",
    date = new Date().toISOString(),
    conversationIndex = null,
    internalDate = null,
    bodyContentType,
    rawRecipients,
  } = overrides;

  return {
    id,
    threadId,
    labelIds,
    snippet,
    historyId,
    attachments,
    inline,
    headers,
    textPlain,
    textHtml,
    subject,
    date,
    conversationIndex,
    internalDate,
    bodyContentType,
    rawRecipients,
  };
}

export function getGroup(
  overrides: Partial<
    Prisma.GroupGetPayload<{ include: { items: true; rule: true } }>
  > = {},
): Prisma.GroupGetPayload<{ include: { items: true; rule: true } }> {
  const {
    id = "group1",
    name = "group",
    createdAt = new Date(),
    updatedAt = new Date(),
    emailAccountId = "emailAccountId",
    prompt = null,
    items = [],
    rule = null,
  } = overrides;

  return {
    id,
    name,
    createdAt,
    updatedAt,
    emailAccountId,
    prompt,
    items,
    rule,
  };
}

export function getGroupItem(overrides: Partial<GroupItem> = {}): GroupItem {
  const {
    id = "groupItem1",
    createdAt = new Date(),
    updatedAt = new Date(),
    groupId = "groupId",
    type = GroupItemType.FROM,
    value = "test@example.com",
    exclude = false,
    reason = null,
    threadId = null,
    messageId = null,
    source = null,
  } = overrides;

  return {
    id,
    createdAt,
    updatedAt,
    groupId,
    type,
    value,
    exclude,
    reason,
    threadId,
    messageId,
    source,
  };
}
