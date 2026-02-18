import type { ParsedMessage } from "@/server/lib/types";
import { SearchIndexQueue } from "@/server/features/search/index/queue";
import type { SearchIndexedDocument } from "@/server/features/search/index/types";
import type { Logger } from "@/server/lib/logger";
import {
  upsertSearchAlias,
  upsertSearchEntity,
} from "@/server/features/search/index/repository";
import { extractEmailAddress, extractNameFromEmail } from "@/server/lib/email";

function toIsoDate(value: Date | string | number | undefined): string | undefined {
  if (value === undefined || value === null) return undefined;
  if (value instanceof Date) {
    if (!Number.isFinite(value.getTime())) return undefined;
    return value.toISOString();
  }

  if (typeof value === "number") {
    if (!Number.isFinite(value)) return undefined;
    return new Date(value).toISOString();
  }

  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed)) return undefined;
  return new Date(parsed).toISOString();
}

function computeFreshnessScore(occurredAtIso: string | undefined): number {
  if (!occurredAtIso) return 0;
  const ts = Date.parse(occurredAtIso);
  if (!Number.isFinite(ts)) return 0;
  const days = Math.max(0, (Date.now() - ts) / (24 * 60 * 60 * 1000));
  if (days <= 1) return 1;
  if (days <= 7) return 0.8;
  if (days <= 30) return 0.55;
  if (days <= 90) return 0.3;
  return 0.1;
}

export async function enqueueEmailDocumentForIndexing(params: {
  userId: string;
  emailAccountId: string;
  provider: "google" | "microsoft";
  message: ParsedMessage;
  logger: Logger;
}) {
  const subject = params.message.subject || params.message.headers?.subject || "(No Subject)";
  const body = params.message.textPlain || params.message.textHtml || params.message.snippet || "";
  const snippet = params.message.snippet || body.slice(0, 280);
  const occurredAt = params.message.date as Date | string | number | undefined;
  const occurredAtIso = toIsoDate(occurredAt);

  const payload: SearchIndexedDocument = {
    userId: params.userId,
    emailAccountId: params.emailAccountId,
    connector: "email",
    sourceType: "message",
    sourceId: params.message.id,
    sourceParentId: params.message.threadId,
    title: subject,
    snippet,
    bodyText: body,
    authorIdentity: params.message.headers?.from || undefined,
    occurredAt: occurredAtIso,
    updatedSourceAt: occurredAtIso,
    freshnessScore: computeFreshnessScore(occurredAtIso),
    authorityScore: 0.5,
    metadata: {
      provider: params.provider,
      threadId: params.message.threadId,
      from: params.message.headers?.from ?? null,
      to: params.message.headers?.to ?? null,
      cc: params.message.headers?.cc ?? null,
      bcc: params.message.headers?.bcc ?? null,
      labelIds: params.message.labelIds ?? [],
      hasAttachment: Array.isArray(params.message.attachments) && params.message.attachments.length > 0,
      attachmentCount: params.message.attachments?.length ?? 0,
      isDraft: params.message.labelIds?.includes("DRAFT") ?? false,
      isSent: params.message.labelIds?.includes("SENT") ?? false,
      isInbox: params.message.labelIds?.includes("INBOX") ?? false,
      isUnread: params.message.labelIds?.includes("UNREAD") ?? false,
    },
  };

  try {
    await SearchIndexQueue.enqueueUpsert(payload);
    const senderEmail = extractEmailAddress(params.message.headers?.from || "");
    const senderName = extractNameFromEmail(params.message.headers?.from || "");

    if (senderEmail) {
      void upsertSearchEntity({
        userId: params.userId,
        emailAccountId: params.emailAccountId,
        entityType: "person",
        canonicalValue: senderEmail,
        displayValue: senderName || senderEmail,
        confidence: 0.9,
        metadata: {
          source: "email",
          role: "sender",
        },
      });
      if (senderName && senderName.toLowerCase() !== senderEmail.toLowerCase()) {
        void upsertSearchAlias({
          userId: params.userId,
          emailAccountId: params.emailAccountId,
          entityType: "person",
          canonicalValue: senderEmail,
          aliasValue: senderName,
          confidence: 0.8,
          metadata: {
            source: "email",
            role: "sender_name",
          },
        });
      }
    }
  } catch (error) {
    params.logger.warn("Failed to enqueue email document for indexing", {
      userId: params.userId,
      emailAccountId: params.emailAccountId,
      messageId: params.message.id,
      error,
    });
  }
}
