import { subMonths } from "date-fns/subMonths";
import { createScopedLogger } from "@/server/lib/logger";
import type { EmailAccountWithAI } from "@/server/lib/llms/types";
import type { EmailForLLM } from "@/server/types";
import type { EmailProvider } from "@/features/email/types";
import { captureException } from "@/server/lib/error";
import { extractEmailAddress } from "@/server/lib/email";

const logger = createScopedLogger("reply-context-collector");

export type ReplyContextCollectorResult = {
  notes?: string | null;
  relevantEmails: string[];
};

/**
 * Deduplicate by normalized content and limit size.
 * Uses a simple string hash (first 200 chars) to avoid storing huge strings in the set.
 */
function deduplicate(items: string[], maxItems: number): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const item of items) {
    const key = item.slice(0, 200).trim() || item;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(item);
    if (out.length >= maxItems) break;
  }
  return out;
}

export async function aiCollectReplyContext({
  currentThread,
  emailAccount,
  emailProvider,
}: {
  currentThread: EmailForLLM[];
  emailAccount: EmailAccountWithAI;
  emailProvider: EmailProvider;
}): Promise<ReplyContextCollectorResult | null> {
  try {
    const sixMonthsAgo = subMonths(new Date(), 6);
    const firstMessage = currentThread[0];
    const lastMessage = currentThread[currentThread.length - 1];
    const subject = firstMessage?.subject?.trim();
    const senderEmail = lastMessage
      ? extractEmailAddress(lastMessage.from)
      : undefined;
    const allResults: string[] = [];

    // Search 1: by subject (existing logic)
    if (subject) {
      const normalizedSubjectQuery = subject.toLowerCase();
      const subjectTokens = normalizedSubjectQuery
        .split(/\s+/)
        .map((token) => token.replace(/[^a-z0-9]/g, ""))
        .filter((token) => token.length >= 4);

      const { messages: subjectMessages } =
        await emailProvider.getMessagesWithPagination({
          query: subject,
          maxResults: 20,
          after: sixMonthsAgo,
        });

      const subjectItems = subjectMessages
        .map((message) => {
          const subj = message.subject ?? "";
          const snippet = message.snippet ?? message.textPlain ?? "";
          return {
            subject: subj,
            snippet,
            combined: `${subj}\n${snippet}`.trim(),
            subjectLower: subj.toLowerCase(),
            snippetLower: snippet.toLowerCase(),
          };
        })
        .filter((item) => {
          const directSubjectMatch = item.subjectLower.includes(
            normalizedSubjectQuery,
          );
          const directSnippetMatch = item.snippetLower.includes(
            normalizedSubjectQuery,
          );
          if (directSubjectMatch || directSnippetMatch) return true;
          if (subjectTokens.length === 0) return false;
          return subjectTokens.some(
            (token) =>
              item.subjectLower.includes(token) ||
              item.snippetLower.includes(token),
          );
        })
        .map((item) => item.combined);

      allResults.push(...subjectItems);
    }

    // Search 2: by sender
    if (senderEmail) {
      const { messages: senderMessages } =
        await emailProvider.getMessagesWithPagination({
          query: `from:${senderEmail}`,
          maxResults: 10,
          after: sixMonthsAgo,
        });
      const senderItems = senderMessages.map(
        (m) => `${m.subject ?? ""}\n${m.snippet ?? m.textPlain ?? ""}`.trim(),
      );
      allResults.push(...senderItems);
    }

    // Search 3: key terms from latest message (subject + content snippet)
    const lastContent =
      lastMessage?.content?.slice(0, 500) ?? lastMessage?.subject ?? "";
    const keyTerms = (lastContent + " " + (subject ?? ""))
      .split(/\s+/)
      .map((w) => w.replace(/[^a-z0-9]/gi, ""))
      .filter((w) => w.length >= 4)
      .slice(0, 5);
    if (keyTerms.length > 0) {
      const termsQuery = keyTerms.join(" OR ");
      try {
        const { messages: termMessages } =
          await emailProvider.getMessagesWithPagination({
            query: termsQuery,
            maxResults: 10,
            after: sixMonthsAgo,
          });
        const termItems = termMessages.map(
          (m) =>
            `${m.subject ?? ""}\n${m.snippet ?? m.textPlain ?? ""}`.trim(),
        );
        allResults.push(...termItems);
      } catch (err) {
        logger.trace("Key-terms search failed, skipping", {
          termsQuery,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }

    const relevantEmails = deduplicate(allResults, 20);
    return { notes: null, relevantEmails };
  } catch (error) {
    logger.error("Reply context collection failed", {
      email: emailAccount.email,
      error,
    });
    captureException(error, {
      extra: {
        scope: "reply-context-collector",
        email: emailAccount.email,
        userId: emailAccount.userId,
      },
    });
    return null;
  }
}
