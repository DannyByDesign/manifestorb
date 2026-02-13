import prisma from "@/server/db/client";
import { ActionType } from "@/generated/prisma/enums";
import type { ExecutedRule } from "@/generated/prisma/client";
import type { Logger } from "@/server/lib/logger";
import type { EmailProvider } from "@/features/email/types";
import { convertEmailHtmlToText } from "@/server/lib/mail";
import type { ParsedMessage } from "@/server/types";

export async function handlePreviousDraftDeletion(params: {
  client: EmailProvider;
  executedRule: Pick<ExecutedRule, "id" | "threadId" | "emailAccountId">;
  logger: Logger;
}) {
  try {
    const previousDraftAction = await prisma.executedAction.findFirst({
      where: {
        executedRule: {
          threadId: params.executedRule.threadId,
          emailAccountId: params.executedRule.emailAccountId,
        },
        type: ActionType.DRAFT_EMAIL,
        draftId: { not: null },
        executedRuleId: { not: params.executedRule.id },
        draftSendLog: null,
      },
      orderBy: { createdAt: "desc" },
      select: { id: true, draftId: true, content: true },
    });

    if (!previousDraftAction?.draftId) {
      params.logger.info("No previous draft found for this thread to delete");
      return;
    }

    const currentDraftDetails = await params.client.getDraft(previousDraftAction.draftId);
    if (!currentDraftDetails?.textPlain) {
      params.logger.warn("Unable to fetch current draft details, skipping deletion", {
        previousDraftId: previousDraftAction.draftId,
      });
      return;
    }

    const isUnmodified =
      !previousDraftAction.content ||
      isDraftUnmodified({
        originalContent: previousDraftAction.content,
        currentDraft: currentDraftDetails,
        logger: params.logger,
      });

    if (!isUnmodified) {
      params.logger.info("Draft content modified by user, skipping deletion.");
      return;
    }

    await Promise.all([
      params.client.deleteDraft(previousDraftAction.draftId),
      prisma.executedAction.update({
        where: { id: previousDraftAction.id },
        data: { wasDraftSent: false },
      }),
    ]);
  } catch (error) {
    params.logger.error("Error finding or deleting previous draft", {
      error: (error as Error)?.message || error,
    });
  }
}

export function extractDraftPlainText(draft: ParsedMessage): string {
  if (draft.bodyContentType === "html") {
    return draft.textPlain
      ? convertEmailHtmlToText({
          htmlText: draft.textPlain,
          includeLinks: false,
        })
      : "";
  }
  return draft.textPlain || "";
}

export function stripQuotedContent(text: string): string {
  const quoteHeaderPatterns = [
    /\n\nOn .* wrote:/,
    /\n\n----+ Original Message ----+/,
    /\n\n>+ On .*/,
    /\n\nFrom: .*/,
  ];

  let result = text;
  for (const pattern of quoteHeaderPatterns) {
    const parts = result.split(pattern);
    if (parts.length > 1) {
      result = parts[0];
      break;
    }
  }

  return result.trim();
}

export function isDraftUnmodified(params: {
  originalContent: string;
  currentDraft: ParsedMessage;
  logger: Logger;
}): boolean {
  const currentText = extractDraftPlainText(params.currentDraft);
  const currentReplyContent = stripQuotedContent(currentText);

  const originalWithBr = params.originalContent.replace(/\n/g, "<br>");
  const originalContentPlain = convertEmailHtmlToText({
    htmlText: originalWithBr,
    includeLinks: false,
  });
  const originalContentTrimmed = originalContentPlain.trim();

  params.logger.trace("Comparing draft content", {
    original: originalContentTrimmed,
    current: currentReplyContent,
  });

  return originalContentTrimmed === currentReplyContent;
}
