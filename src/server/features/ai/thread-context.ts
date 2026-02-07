/**
 * Thread context: fetch email context for messageId/threadId for AI context injection.
 * Tries direct EmailMessage lookup first, falls back to InAppNotification metadata.
 */
import prisma from "@/server/db/client";
import type { Logger } from "@/server/lib/logger";

/**
 * Fetch email context for a given messageId or threadId.
 * Returns a markdown block for the system prompt, or "" if none found.
 */
export async function getThreadContext({
  userId,
  messageId,
  threadId,
  logger,
}: {
  userId: string;
  messageId?: string;
  threadId?: string;
  logger: Logger;
}): Promise<string> {
  if (!messageId && !threadId) return "";

  let emailContext: {
    subject: string;
    from: string;
    to: string;
    snippet: string;
    receivedAt: Date;
    threadId?: string;
    messageId?: string;
  } | null = null;

  if (messageId) {
    const message = await prisma.emailMessage
      .findFirst({
        where: {
          OR: [{ id: messageId }, { messageId }],
          emailAccount: { userId },
        },
        select: {
          from: true,
          to: true,
          date: true,
          threadId: true,
          messageId: true,
        },
      })
      .catch(() => null);

    if (message) {
      emailContext = {
        subject: "(No subject)",
        from: message.from,
        to: message.to,
        snippet: "",
        receivedAt: message.date,
        threadId: message.threadId,
        messageId: message.messageId,
      };
    }
  }

  if (!emailContext && threadId) {
    const message = await prisma.emailMessage
      .findFirst({
        where: {
          threadId,
          emailAccount: { userId },
        },
        orderBy: { date: "desc" },
        select: {
          from: true,
          to: true,
          date: true,
          threadId: true,
          messageId: true,
        },
      })
      .catch(() => null);

    if (message) {
      emailContext = {
        subject: "(No subject)",
        from: message.from,
        to: message.to,
        snippet: "",
        receivedAt: message.date,
        threadId: message.threadId,
        messageId: message.messageId,
      };
    }
  }

  if (!emailContext) {
    const recent = await prisma.inAppNotification.findMany({
      where: { userId },
      orderBy: { createdAt: "desc" },
      take: 10,
      select: { title: true, body: true, metadata: true },
    });

    const meta = messageId
      ? recent.find(
          (r) =>
            (r.metadata as Record<string, unknown>)?.messageId === messageId,
        )
      : threadId
        ? recent.find(
            (r) =>
              (r.metadata as Record<string, unknown>)?.threadId === threadId,
          )
        : null;

    if (meta) {
      return `
---
## Current context (from notification)
**${meta.title}**: ${meta.body ?? ""}
When they say "them", "the sender", or "this person", they mean the sender of this email. Proceed to schedule a meeting with that person if they ask (e.g. use create with resource "calendar", data.autoSchedule true).
---
`;
    }

    return "";
  }

  return `
---
## Current context (email thread)
**Subject:** ${emailContext.subject}
**From:** ${emailContext.from}
**To:** ${emailContext.to}
**Received:** ${emailContext.receivedAt.toLocaleString()}
${emailContext.snippet ? `**Preview:** ${emailContext.snippet.substring(0, 500)}` : ""}

When the user says "them", "the sender", or "this person", they mean **${emailContext.from}**. Use this email's data for context when responding to user requests about this email.
---
`;
}
