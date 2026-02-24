import type { ToolResult } from "@/server/features/ai/tools/types";
import type { CapabilityEnvironment } from "@/server/features/ai/tools/runtime/capabilities/types";
import { env as appEnv } from "@/env";
import { Client } from "@upstash/qstash";
import { getInternalApiUrl } from "@/server/lib/internal-api";
import { getCronSecretHeader } from "@/server/lib/cron";
import {
  resolveDefaultCalendarTimeZone,
} from "@/server/features/ai/tools/calendar-time";
import { parseDateBoundInTimeZone } from "@/server/features/ai/tools/timezone";
import {
  capabilityFailureResult,
  classifyCapabilityError,
} from "@/server/features/ai/tools/runtime/capabilities/errors";
import { validateEmailSearchFilter } from "@/server/features/ai/tools/runtime/capabilities/validators/email-search";
import { createCapabilityIdempotencyKey } from "@/server/features/ai/tools/runtime/capabilities/idempotency";
import {
  getEmailMessages,
  getEmailThread,
  modifyEmailMessages,
  trashEmailMessages,
} from "@/server/features/ai/tools/email/primitives";
import { extractEmailAddresses } from "@/server/lib/email";
import prisma from "@/server/db/client";
import { Prisma } from "@/generated/prisma/client";

export interface EmailCapabilities {
  countUnread(filter?: Record<string, unknown>): Promise<ToolResult>;
  search(filter: Record<string, unknown>): Promise<ToolResult>;
  facetThreads(input: { filter?: Record<string, unknown>; maxFacets?: number; scanLimit?: number }): Promise<ToolResult>;
  getThreadMessages(threadId: string): Promise<ToolResult>;
  getMessagesBatch(ids: string[]): Promise<ToolResult>;
  getLatestMessage(threadId: string): Promise<ToolResult>;
  batchArchive(input: { ids?: string[]; filter?: Record<string, unknown>; limit?: number }): Promise<ToolResult>;
  batchTrash(input: { ids?: string[]; filter?: Record<string, unknown>; limit?: number }): Promise<ToolResult>;
  markReadUnread(input: { ids?: string[]; filter?: Record<string, unknown>; limit?: number; read: boolean }): Promise<ToolResult>;
  applyLabels(input: { ids?: string[]; filter?: Record<string, unknown>; limit?: number; labelIds: string[] }): Promise<ToolResult>;
  removeLabels(input: { ids?: string[]; filter?: Record<string, unknown>; limit?: number; labelIds: string[] }): Promise<ToolResult>;
  moveThread(input: { ids?: string[]; filter?: Record<string, unknown>; limit?: number; folderName: string }): Promise<ToolResult>;
  markSpam(ids: string[]): Promise<ToolResult>;
  unsubscribeSender(filterOrIds: {
    ids?: string[];
    filter?: Record<string, unknown>;
  }): Promise<ToolResult>;
  blockSender(ids: string[]): Promise<ToolResult>;
  bulkSenderArchive(filter: Record<string, unknown>): Promise<ToolResult>;
  bulkSenderTrash(filter: Record<string, unknown>): Promise<ToolResult>;
  bulkSenderLabel(filter: {
    filter: Record<string, unknown>;
    labelId: string;
  }): Promise<ToolResult>;
  snoozeThread(ids: string[], snoozeUntil: string): Promise<ToolResult>;
  listFilters(): Promise<ToolResult>;
  createFilter(input: {
    from: string;
    addLabelIds?: string[];
    removeLabelIds?: string[];
    autoArchiveLabelName?: string;
  }): Promise<ToolResult>;
  deleteFilter(id: string): Promise<ToolResult>;
  listDrafts(limit?: number): Promise<ToolResult>;
  getDraft(draftId: string): Promise<ToolResult>;
  createDraft(input: {
    to?: string[];
    cc?: string[];
    bcc?: string[];
    subject?: string;
    body: string;
    type?: "new" | "reply" | "forward";
    parentId?: string;
    sendOnApproval?: boolean;
  }): Promise<ToolResult>;
  updateDraft(input: {
    draftId: string;
    subject?: string;
    body?: string;
  }): Promise<ToolResult>;
  deleteDraft(draftId: string): Promise<ToolResult>;
  sendDraft(draftId: string): Promise<ToolResult>;
  sendNow(input: {
    draftId?: string;
    to?: string[];
    subject?: string;
    body?: string;
  }): Promise<ToolResult>;
  reply(input: {
    parentId: string;
    body: string;
    subject?: string;
    mode?: "send" | "draft";
    replyAll?: boolean;
  }): Promise<ToolResult>;
  forward(input: {
    parentId: string;
    to: string[];
    body?: string;
    subject?: string;
  }): Promise<ToolResult>;
  scheduleSend(_draftId: string, _sendAt: string): Promise<ToolResult>;
}

function uniqueIds(ids: string[]): string[] {
  return Array.from(new Set(ids.map((id) => id.trim()).filter(Boolean)));
}

function asMetaItemCount(count: number): ToolResult["meta"] {
  return { resource: "email", itemCount: count };
}

async function coerceToMessageIds(
  env: CapabilityEnvironment,
  ids: string[],
): Promise<string[]> {
  const provider = env.toolContext.providers.email;
  const normalized = uniqueIds(ids);
  const out: string[] = [];

  for (const id of normalized) {
    try {
      const thread = await getEmailThread(provider, id);
      if (thread.messages.length > 0) {
        out.push(thread.messages[0]!.id);
        continue;
      }
    } catch {
      // If it's not a thread id, treat it as a message id.
    }
    out.push(id);
  }

  return uniqueIds(out);
}

async function coerceToThreadIds(
  env: CapabilityEnvironment,
  ids: string[],
): Promise<string[]> {
  const provider = env.toolContext.providers.email;
  const normalized = uniqueIds(ids);
  const out: string[] = [];

  for (const id of normalized) {
    try {
      const thread = await getEmailThread(provider, id);
      out.push(thread.id);
      continue;
    } catch {
      // fallthrough
    }

    try {
      const messages = await getEmailMessages(provider, [id]);
      if (messages.length > 0) {
        out.push(messages[0]!.threadId);
      }
    } catch {
      // ignore unresolved ID
    }
  }

  return uniqueIds(out);
}

export function createEmailCapabilities(capEnv: CapabilityEnvironment): EmailCapabilities {
  const provider = capEnv.toolContext.providers.email;
  let defaultTimeZonePromise:
    | Promise<{ timeZone: string } | { error: string }>
    | null = null;

  const getDefaultTimeZone = async () => {
    if (!defaultTimeZonePromise) {
      defaultTimeZonePromise = resolveDefaultCalendarTimeZone({
        userId: capEnv.runtime.userId,
        emailAccountId: capEnv.runtime.emailAccountId,
      });
    }
    return defaultTimeZonePromise;
  };

  const resolveRequestedTimeZone = (
    source: Record<string, unknown>,
    dateRange?: Record<string, unknown>,
  ): string | undefined =>
    (typeof dateRange?.timeZone === "string" ? dateRange.timeZone : undefined) ??
    (typeof dateRange?.timezone === "string" ? dateRange.timezone : undefined) ??
    (typeof source.timeZone === "string" ? source.timeZone : undefined) ??
    (typeof source.timezone === "string" ? source.timezone : undefined);

  const resolveProviderDateBounds = async (source: Record<string, unknown>) => {
    const dateRange =
      source.dateRange && typeof source.dateRange === "object"
        ? (source.dateRange as Record<string, unknown>)
        : undefined;
    const afterRaw =
      (typeof dateRange?.after === "string" ? dateRange.after : undefined) ??
      (typeof source.after === "string" ? source.after : undefined);
    const beforeRaw =
      (typeof dateRange?.before === "string" ? dateRange.before : undefined) ??
      (typeof source.before === "string" ? source.before : undefined);
    if (!afterRaw && !beforeRaw) {
      return { ok: true as const, after: undefined, before: undefined };
    }

    const requestedTimeZone = resolveRequestedTimeZone(source, dateRange);
    const resolvedTimeZone =
      requestedTimeZone && requestedTimeZone.trim().length > 0
        ? requestedTimeZone.trim()
        : (() => null)();

    const fallbackTimeZone = async () => {
      const defaultTimeZone = await getDefaultTimeZone();
      if ("error" in defaultTimeZone) {
        return { ok: false as const, error: defaultTimeZone.error };
      }
      return { ok: true as const, timeZone: defaultTimeZone.timeZone };
    };

    const resolved =
      resolvedTimeZone !== null
        ? { ok: true as const, timeZone: resolvedTimeZone }
        : await fallbackTimeZone();
    if (!resolved.ok) return resolved;

    const after = afterRaw
      ? parseDateBoundInTimeZone(afterRaw, resolved.timeZone, "start")
      : null;
    if (afterRaw && !after) {
      return {
        ok: false as const,
        error:
          `Invalid start date "${afterRaw}". Use ISO-8601 or local datetime in timezone ${resolved.timeZone}.`,
      };
    }

    const before = beforeRaw
      ? parseDateBoundInTimeZone(beforeRaw, resolved.timeZone, "end")
      : null;
    if (beforeRaw && !before) {
      return {
        ok: false as const,
        error:
          `Invalid end date "${beforeRaw}". Use ISO-8601 or local datetime in timezone ${resolved.timeZone}.`,
      };
    }

    return {
      ok: true as const,
      after: after ?? undefined,
      before: before ?? undefined,
    };
  };

  const runUnifiedSearchThreads = async (
    filter: Record<string, unknown>,
    mailboxOverride?: "inbox" | "sent",
  ): Promise<ToolResult> => {
    const validatedFilter = validateEmailSearchFilter(filter);
    if (!validatedFilter.ok) {
      return {
        success: false,
        error: validatedFilter.error,
        message: validatedFilter.message,
        clarification: {
          kind: validatedFilter.clarificationKind ?? "invalid_fields",
          prompt: validatedFilter.prompt,
          missingFields: validatedFilter.fields,
        },
        data: validatedFilter.concept
          ? { concept: validatedFilter.concept }
          : undefined,
      };
    }

    const requestFilter = validatedFilter.filter;
    const dateRange =
      requestFilter && typeof requestFilter.dateRange === "object"
        ? (requestFilter.dateRange as Record<string, unknown>)
        : undefined;

    const inferredUnrepliedToSent = requestFilter.unrepliedToSent === true;

    const mailboxCandidate =
      mailboxOverride ??
      (typeof requestFilter.mailbox === "string" ? requestFilter.mailbox : undefined) ??
      (requestFilter.sentByMe === true ? "sent" : undefined);
    const mailbox =
      mailboxCandidate === "inbox" || mailboxCandidate === "sent"
        ? mailboxCandidate
        : undefined;
    const ensureMailboxScopeInQuery = (
      query: string | undefined,
      mailboxScope: "inbox" | "sent" | undefined,
    ): string | undefined => {
      if (!query || query.trim().length === 0) {
        return mailboxScope ? `in:${mailboxScope}` : query;
      }
      if (/\bin:(inbox|sent|draft|trash|spam|all)\b/i.test(query)) {
        return query.trim();
      }
      if (!mailboxScope) return query.trim();
      return `in:${mailboxScope} ${query}`.trim();
    };

    const fromConcept =
      typeof requestFilter.fromConcept === "string" ? requestFilter.fromConcept.trim() : "";
    if (fromConcept) {
      return {
        success: false,
        error: "concept_definition_required",
        clarification: {
          kind: "concept_definition_required",
          prompt: "email_identity_concept_requires_definition",
        },
        data: {
          concept: { field: "from", value: fromConcept },
        },
      };
    }
    const toConcept =
      typeof requestFilter.toConcept === "string" ? requestFilter.toConcept.trim() : "";
    if (toConcept) {
      return {
        success: false,
        error: "concept_definition_required",
        clarification: {
          kind: "concept_definition_required",
          prompt: "email_identity_concept_requires_definition",
        },
        data: {
          concept: { field: "to", value: toConcept },
        },
      };
    }
    const ccConcept =
      typeof requestFilter.ccConcept === "string" ? requestFilter.ccConcept.trim() : "";
    if (ccConcept) {
      return {
        success: false,
        error: "concept_definition_required",
        clarification: {
          kind: "concept_definition_required",
          prompt: "email_identity_concept_requires_definition",
        },
        data: {
          concept: { field: "cc", value: ccConcept },
        },
      };
    }

    const requestFrom = typeof requestFilter.from === "string" ? requestFilter.from : undefined;
    const requestTo = typeof requestFilter.to === "string" ? requestFilter.to : undefined;
    const requestCc = typeof requestFilter.cc === "string" ? requestFilter.cc : undefined;

    const fromEmails =
      Array.isArray(requestFilter.fromEmails) && requestFilter.fromEmails.length > 0
        ? (requestFilter.fromEmails as string[])
        : undefined;
    const fromDomains =
      Array.isArray(requestFilter.fromDomains) && requestFilter.fromDomains.length > 0
        ? (requestFilter.fromDomains as string[])
        : undefined;
    const toEmails =
      Array.isArray(requestFilter.toEmails) && requestFilter.toEmails.length > 0
        ? (requestFilter.toEmails as string[])
        : undefined;
    const toDomains =
      Array.isArray(requestFilter.toDomains) && requestFilter.toDomains.length > 0
        ? (requestFilter.toDomains as string[])
        : undefined;
    const ccEmails =
      Array.isArray(requestFilter.ccEmails) && requestFilter.ccEmails.length > 0
        ? (requestFilter.ccEmails as string[])
        : undefined;
    const ccDomains =
      Array.isArray(requestFilter.ccDomains) && requestFilter.ccDomains.length > 0
        ? (requestFilter.ccDomains as string[])
        : undefined;

    if (inferredUnrepliedToSent) {
      const beforeRaw =
        dateRange && typeof dateRange.before === "string"
          ? dateRange.before
          : undefined;
      const afterRaw =
        dateRange && typeof dateRange.after === "string"
          ? dateRange.after
          : undefined;
      const before = beforeRaw ? new Date(beforeRaw) : undefined;
      const after = afterRaw ? new Date(afterRaw) : undefined;
      if (!after || !before || !Number.isFinite(after.getTime()) || !Number.isFinite(before.getTime())) {
        return {
          success: false,
          error: "missing_date_range",
          clarification: {
            kind: "missing_fields",
            prompt: "email_unreplied_date_range_required",
            missingFields: ["dateRange.after", "dateRange.before"],
          },
        };
      }

      try {
        const limit =
          typeof requestFilter.limit === "number" && Number.isFinite(requestFilter.limit)
            ? Math.min(500, Math.max(1, Math.trunc(requestFilter.limit)))
            : 200;

        type Row = {
          threadId: string;
          messageId: string;
          sentAt: Date;
          toHeader: string;
          subject: string | null;
          snippet: string | null;
        };

        const rows = await prisma.$queryRaw<Row[]>(Prisma.sql`
          WITH last_sent AS (
            SELECT DISTINCT ON (em."threadId")
              em."threadId" AS "threadId",
              em."messageId" AS "messageId",
              em."date" AS "sentAt",
              em."to" AS "toHeader"
            FROM "EmailMessage" em
            WHERE em."emailAccountId" = ${capEnv.runtime.emailAccountId}
              AND em."sent" = true
              AND em."date" >= ${after}
              AND em."date" <= ${before}
            ORDER BY em."threadId", em."date" DESC
          ),
          replied AS (
            SELECT ls."threadId" AS "threadId"
            FROM last_sent ls
            JOIN "EmailMessage" em
              ON em."emailAccountId" = ${capEnv.runtime.emailAccountId}
              AND em."threadId" = ls."threadId"
              AND em."sent" = false
              AND em."date" > ls."sentAt"
            GROUP BY ls."threadId"
          )
          SELECT
            ls."threadId",
            ls."messageId",
            ls."sentAt",
            ls."toHeader",
            sd."title" AS "subject",
            sd."snippet" AS "snippet"
          FROM last_sent ls
          LEFT JOIN replied r ON r."threadId" = ls."threadId"
          LEFT JOIN "SearchDocument" sd
            ON sd."userId" = ${capEnv.runtime.userId}
            AND sd."connector" = 'email'
            AND sd."sourceType" = 'message'
            AND sd."sourceId" = ls."messageId"
            AND (sd."emailAccountId" = ${capEnv.runtime.emailAccountId} OR sd."emailAccountId" IS NULL)
            AND sd."isDeleted" = false
          WHERE r."threadId" IS NULL
          ORDER BY ls."sentAt" DESC
          LIMIT ${limit};
        `);

        return {
          success: true,
          data: rows.map((row) => ({
            threadId: row.threadId,
            messageId: row.messageId,
            subject: row.subject ?? "(No subject)",
            date: row.sentAt instanceof Date ? row.sentAt.toISOString() : String(row.sentAt),
            to: row.toHeader,
            cc: "",
            snippet: row.snippet ?? "",
          })),
          message:
            rows.length === 0
              ? "No unreplied sent threads found in that window."
              : `Found ${rows.length} sent thread${rows.length === 1 ? "" : "s"} without a reply.`,
          meta: asMetaItemCount(rows.length),
        };
      } catch (error) {
        capEnv.runtime.logger.warn("unrepliedToSent query failed; falling back to provider scan", {
          userId: capEnv.runtime.userId,
          emailAccountId: capEnv.runtime.emailAccountId,
          error,
        });

        try {
          const resolvedBounds = await resolveProviderDateBounds(requestFilter);
          if (!resolvedBounds.ok) {
            return {
              success: false,
              error: "invalid_date_range",
              message: resolvedBounds.error,
              clarification: {
                kind: "invalid_fields",
                prompt: "email_date_range_invalid",
                missingFields: ["dateRange.after", "dateRange.before"],
              },
            };
          }

          const requestQuery =
            typeof requestFilter.query === "string" && requestFilter.query.trim().length > 0
              ? requestFilter.query.trim()
              : undefined;
          const requestText =
            typeof requestFilter.text === "string" && requestFilter.text.trim().length > 0
              ? requestFilter.text.trim()
              : undefined;
          const semanticQuery = requestQuery ?? requestText ?? undefined;
          const scopedQuery = ensureMailboxScopeInQuery(semanticQuery, mailbox ?? "sent");
          const providerResult = await provider.search({
            query: scopedQuery ?? "",
            text: requestText,
            from: requestFrom,
            fromEmails,
            fromDomains,
            to: requestTo,
            toEmails,
            toDomains,
            cc: requestCc,
            ccEmails,
            ccDomains,
            category:
              requestFilter.category === "primary" ||
              requestFilter.category === "promotions" ||
              requestFilter.category === "social" ||
              requestFilter.category === "updates" ||
              requestFilter.category === "forums"
                ? requestFilter.category
                : undefined,
            hasAttachment:
              typeof requestFilter.hasAttachment === "boolean"
                ? requestFilter.hasAttachment
                : undefined,
            attachmentMimeTypes: Array.isArray(requestFilter.attachmentMimeTypes)
              ? (requestFilter.attachmentMimeTypes as string[])
              : undefined,
            attachmentFilenameContains:
              typeof requestFilter.attachmentFilenameContains === "string"
                ? requestFilter.attachmentFilenameContains
                : undefined,
            sentByMe: true,
            ...(resolvedBounds.after ? { after: resolvedBounds.after } : {}),
            ...(resolvedBounds.before ? { before: resolvedBounds.before } : {}),
            limit: 120,
            fetchAll: false,
          });

          const ownerEmail = (capEnv.runtime.email ?? "").trim().toLowerCase();
          const threadIds = Array.from(
            new Set(
              providerResult.messages
                .map((message) =>
                  typeof message.threadId === "string" && message.threadId.length > 0
                    ? message.threadId
                    : null,
                )
                .filter((threadId): threadId is string => Boolean(threadId)),
            ),
          );

          const unrepliedThreads: Array<{
            threadId: string;
            messageId: string;
            subject: string;
            date: string;
            to: string;
            cc: string;
          }> = [];

          for (const threadId of threadIds.slice(0, 80)) {
            try {
              const thread = await provider.getThread(threadId);
              const messages = Array.isArray(thread.messages) ? thread.messages : [];
              if (messages.length === 0) continue;

              const sorted = [...messages].sort((a, b) => {
                const aTs = Date.parse(a.internalDate ?? a.date ?? "");
                const bTs = Date.parse(b.internalDate ?? b.date ?? "");
                return (Number.isFinite(aTs) ? aTs : 0) - (Number.isFinite(bTs) ? bTs : 0);
              });

              const sent = sorted.filter((m) => {
                const fromHeader = (m.headers?.from ?? "").toLowerCase();
                return ownerEmail.length > 0 && fromHeader.includes(ownerEmail);
              });
              const lastSent = sent[sent.length - 1];
              if (!lastSent) continue;

              const lastSentTs = Date.parse(lastSent.internalDate ?? lastSent.date ?? "");
              if (!Number.isFinite(lastSentTs)) continue;

              const hasReply = sorted.some((m) => {
                const ts = Date.parse(m.internalDate ?? m.date ?? "");
                if (!Number.isFinite(ts) || ts <= lastSentTs) return false;
                const fromHeader = (m.headers?.from ?? "").toLowerCase();
                return ownerEmail.length === 0 || !fromHeader.includes(ownerEmail);
              });
              if (hasReply) continue;

              unrepliedThreads.push({
                threadId,
                messageId: lastSent.id,
                subject: lastSent.subject || lastSent.headers?.subject || "(No subject)",
                date: lastSent.internalDate ?? lastSent.date ?? "",
                to: lastSent.headers?.to ?? "",
                cc: lastSent.headers?.cc ?? "",
              });
            } catch {
              continue;
            }
          }

          return {
            success: true,
            data: unrepliedThreads,
            message:
              unrepliedThreads.length === 0
                ? "No unreplied sent threads found in that window."
                : `Found ${unrepliedThreads.length} sent thread${unrepliedThreads.length === 1 ? "" : "s"} without a reply.`,
            meta: asMetaItemCount(unrepliedThreads.length),
          };
        } catch (fallbackError) {
          return capabilityFailureResult(fallbackError, "I couldn't find unreplied sent threads right now.", {
            resource: "email",
          });
        }
      }
    }

    try {
      const requestQuery =
        typeof requestFilter.query === "string" && requestFilter.query.trim().length > 0
          ? requestFilter.query.trim()
          : undefined;
      const requestText =
        typeof requestFilter.text === "string" && requestFilter.text.trim().length > 0
          ? requestFilter.text.trim()
          : undefined;
      const semanticQuery = requestQuery ?? requestText ?? undefined;
      const unread = typeof requestFilter.unread === "boolean" ? requestFilter.unread : undefined;
      const unreadToken = unread === true ? "is:unread" : unread === false ? "-is:unread" : "";
      const queryWithUnread =
        unreadToken.length > 0
          ? [semanticQuery, unreadToken].filter(Boolean).join(" ").trim()
          : semanticQuery;
      const scopedQuery = ensureMailboxScopeInQuery(queryWithUnread, mailbox);

      const resolvedBounds = await resolveProviderDateBounds(requestFilter);
      if (!resolvedBounds.ok) {
        return {
          success: false,
          error: "invalid_date_range",
          message: resolvedBounds.error,
          clarification: {
            kind: "invalid_fields",
            prompt: "email_date_range_invalid",
            missingFields: ["dateRange.after", "dateRange.before"],
          },
        };
      }

      const result = await provider.search({
        query: scopedQuery ?? "",
        text: requestText,
        from: requestFrom,
        to: requestTo,
        cc: requestCc,
        fromEmails,
        fromDomains,
        toEmails,
        toDomains,
        ccEmails,
        ccDomains,
        category:
          requestFilter.category === "primary" ||
          requestFilter.category === "promotions" ||
          requestFilter.category === "social" ||
          requestFilter.category === "updates" ||
          requestFilter.category === "forums"
            ? requestFilter.category
            : undefined,
        hasAttachment:
          typeof requestFilter.hasAttachment === "boolean"
            ? requestFilter.hasAttachment
            : undefined,
        attachmentMimeTypes: Array.isArray(requestFilter.attachmentMimeTypes)
          ? (requestFilter.attachmentMimeTypes as string[])
          : undefined,
        attachmentFilenameContains:
          typeof requestFilter.attachmentFilenameContains === "string"
            ? requestFilter.attachmentFilenameContains
            : undefined,
        sentByMe: mailbox === "sent" || requestFilter.sentByMe === true,
        receivedByMe:
          typeof requestFilter.receivedByMe === "boolean"
            ? requestFilter.receivedByMe
            : undefined,
        ...(resolvedBounds.after ? { after: resolvedBounds.after } : {}),
        ...(resolvedBounds.before ? { before: resolvedBounds.before } : {}),
        includeNonPrimary:
          typeof requestFilter.includeNonPrimary === "boolean"
            ? requestFilter.includeNonPrimary
            : undefined,
        limit:
          typeof requestFilter.limit === "number" && Number.isFinite(requestFilter.limit)
            ? requestFilter.limit
            : undefined,
        fetchAll: Boolean(requestFilter.fetchAll),
      });

      const data = result.messages.map((message) => ({
        id: message.id,
        threadId: message.threadId || null,
        title: message.subject || message.headers?.subject || "(No subject)",
        snippet: message.snippet ?? "",
        date: message.internalDate ?? message.date ?? null,
        from: message.headers?.from ?? "",
        to: message.headers?.to ?? "",
        hasAttachment: Array.isArray(message.attachments) && message.attachments.length > 0,
        attachmentNames: Array.isArray(message.attachments)
          ? message.attachments
              .map((attachment) =>
                typeof attachment.filename === "string" ? attachment.filename : "",
              )
              .filter((filename) => filename.length > 0)
          : [],
      }));

      return {
        success: true,
        data,
        message:
          data.length === 0
            ? result.nextPageToken
              ? "No matching emails found in the scanned portion yet."
              : "No matching emails found."
            : `Found ${data.length} matching email${data.length === 1 ? "" : "s"}.`,
        truncated: Boolean(result.nextPageToken),
        paging: {
          nextPageToken: result.nextPageToken ?? null,
          totalEstimate:
            typeof result.totalEstimate === "number" && Number.isFinite(result.totalEstimate)
              ? result.totalEstimate
              : data.length,
          coverage: {
            completeness: result.nextPageToken ? "partial" : "complete",
            mailboxScope: mailbox ?? "auto",
          },
        },
        evidence: {
          domain: "email",
          observedAt: new Date().toISOString(),
          scope: mailbox ?? "auto",
          coverage: result.nextPageToken ? "partial" : "complete",
          reusableForFollowUp: !result.nextPageToken,
          staleAfterSec: 180,
        },
        meta: asMetaItemCount(data.length),
      };
    } catch (error) {
      return capabilityFailureResult(error, "I couldn't search your inbox right now.", {
        resource: "email",
      });
    }
  };

  const runUnreadCount = async (
    filter?: Record<string, unknown>,
  ): Promise<ToolResult> => {
    const resolveScope = () => {
      const scopeRaw =
        typeof filter?.scope === "string"
          ? filter.scope.trim().toLowerCase()
          : "inbox";
      const scope: "inbox" | "primary" | "all" =
        scopeRaw === "primary" || scopeRaw === "all" ? scopeRaw : "inbox";
      return { scopeRaw, scope };
    };
    const { scopeRaw, scope } = resolveScope();
    if (
      scopeRaw.length > 0 &&
      scopeRaw !== "inbox" &&
      scopeRaw !== "primary" &&
      scopeRaw !== "all"
    ) {
      return {
        success: false,
        error: "invalid_scope",
        message: "Unread count supports inbox, primary, or all.",
        clarification: {
          kind: "invalid_fields",
          prompt: "email_unread_count_scope_invalid",
          missingFields: ["scope"],
        },
      };
    }

    try {
      const result = await provider.getUnreadCount({ scope });
      const count = Math.max(0, Math.trunc(result.count));
      return {
        success: true,
        data: {
          count,
          exact: Boolean(result.exact),
          scope,
          source: result.exact ? "provider_counter" : "provider_estimate",
          asOf: new Date().toISOString(),
        },
        message: result.exact
          ? `You have ${count} unread email${count === 1 ? "" : "s"} in ${scope} right now.`
          : `You have about ${count} unread email${count === 1 ? "" : "s"} in ${scope} right now.`,
        evidence: {
          domain: "email",
          observedAt: new Date().toISOString(),
          scope,
          coverage: result.exact ? "complete" : "partial",
          reusableForFollowUp: result.exact,
          staleAfterSec: 120,
        },
        meta: asMetaItemCount(1),
      };
    } catch (error) {
      const fallback = await runUnifiedSearchThreads(
        {
          query:
            scope === "primary"
              ? "in:inbox category:primary"
              : scope === "all"
                ? ""
                : "in:inbox",
          unread: true,
          sort: "newest",
          limit: 100,
          fetchAll: false,
          ...(scope === "primary" ? { category: "primary" } : {}),
        },
        scope === "all" ? undefined : "inbox",
      );
      if (!fallback.success) {
        return capabilityFailureResult(error, "I couldn't count unread emails right now.", {
          resource: "email",
        });
      }

      const items = Array.isArray(fallback.data) ? fallback.data : [];
      const paging =
        fallback.paging && typeof fallback.paging === "object"
          ? (fallback.paging as Record<string, unknown>)
          : undefined;
      const totalEstimate =
        paging &&
        typeof paging.totalEstimate === "number" &&
        Number.isFinite(paging.totalEstimate)
          ? Math.max(0, Math.trunc(paging.totalEstimate))
          : null;
      const count = totalEstimate ?? items.length;

      return {
        success: true,
        data: {
          count,
          exact: false,
          scope,
          source: totalEstimate !== null ? "provider_estimate" : "sample_count",
          asOf: new Date().toISOString(),
        },
        message: `You have about ${count} unread email${count === 1 ? "" : "s"} in ${scope} right now.`,
        truncated: fallback.truncated,
        paging: paging ?? undefined,
        evidence: {
          domain: "email",
          observedAt: new Date().toISOString(),
          scope,
          coverage: fallback.truncated ? "partial" : "complete",
          reusableForFollowUp: !fallback.truncated,
          staleAfterSec: 120,
        },
        meta: asMetaItemCount(1),
      };
    }
  };

  const runCountUnread = async (
    filter?: Record<string, unknown>,
  ): Promise<ToolResult> => {
    const scopeRaw =
      typeof filter?.scope === "string"
        ? filter.scope.trim().toLowerCase()
        : "inbox";
    const scope: "inbox" | "primary" | "all" =
      scopeRaw === "primary" || scopeRaw === "all" ? scopeRaw : "inbox";
    if (scopeRaw.length > 0 && scopeRaw !== "inbox" && scopeRaw !== "primary" && scopeRaw !== "all") {
      return {
        success: false,
        error: "invalid_scope",
        message: "Unread count supports inbox, primary, or all.",
        clarification: {
          kind: "invalid_fields",
          prompt: "email_unread_count_scope_invalid",
          missingFields: ["scope"],
        },
      };
    }

    const validatedFilter = validateEmailSearchFilter(filter ?? {});
    if (!validatedFilter.ok) {
      return {
        success: false,
        error: validatedFilter.error,
        message: validatedFilter.message,
        clarification: {
          kind: validatedFilter.clarificationKind ?? "invalid_fields",
          prompt: validatedFilter.prompt,
          missingFields: validatedFilter.fields,
        },
      };
    }

    const requestFilter = validatedFilter.filter;
    if (requestFilter.unread === false) {
      return {
        success: false,
        error: "invalid_fields",
        message: "email.countUnread only supports unread=true (or omitting unread).",
        clarification: {
          kind: "invalid_fields",
          prompt: "email_count_unread_invalid_unread_filter",
          missingFields: ["unread"],
        },
      };
    }

    const resolvedBounds = await resolveProviderDateBounds(requestFilter);
    if (!resolvedBounds.ok) {
      return {
        success: false,
        error: "invalid_date_range",
        message: resolvedBounds.error,
        clarification: {
          kind: "invalid_fields",
          prompt: "email_date_range_invalid",
          missingFields: ["dateRange.after", "dateRange.before"],
        },
      };
    }

    const hasTemporalWindow = Boolean(resolvedBounds.after || resolvedBounds.before);
    const hasAdditionalFilter = Boolean(
      (typeof requestFilter.query === "string" && requestFilter.query.trim()) ||
        (typeof requestFilter.text === "string" && requestFilter.text.trim()) ||
        (typeof requestFilter.from === "string" && requestFilter.from.trim()) ||
        (typeof requestFilter.to === "string" && requestFilter.to.trim()) ||
        (typeof requestFilter.cc === "string" && requestFilter.cc.trim()) ||
        (Array.isArray(requestFilter.fromEmails) && requestFilter.fromEmails.length > 0) ||
        (Array.isArray(requestFilter.fromDomains) && requestFilter.fromDomains.length > 0) ||
        (Array.isArray(requestFilter.toEmails) && requestFilter.toEmails.length > 0) ||
        (Array.isArray(requestFilter.toDomains) && requestFilter.toDomains.length > 0) ||
        (Array.isArray(requestFilter.ccEmails) && requestFilter.ccEmails.length > 0) ||
        (Array.isArray(requestFilter.ccDomains) && requestFilter.ccDomains.length > 0) ||
        typeof requestFilter.category === "string" ||
        typeof requestFilter.hasAttachment === "boolean" ||
        (Array.isArray(requestFilter.attachmentMimeTypes) &&
          requestFilter.attachmentMimeTypes.length > 0) ||
        (typeof requestFilter.attachmentFilenameContains === "string" &&
          requestFilter.attachmentFilenameContains.trim().length > 0),
    );

    if (!hasTemporalWindow && !hasAdditionalFilter) {
      return runUnreadCount({ scope });
    }

    const requestQuery =
      typeof requestFilter.query === "string" && requestFilter.query.trim().length > 0
        ? requestFilter.query.trim()
        : undefined;
    const requestText =
      typeof requestFilter.text === "string" && requestFilter.text.trim().length > 0
        ? requestFilter.text.trim()
        : undefined;
    const scopePrefix =
      scope === "primary" ? "in:inbox category:primary" : scope === "inbox" ? "in:inbox" : "";
    const query = [scopePrefix, requestQuery, requestText, "is:unread"]
      .filter((part): part is string => typeof part === "string" && part.trim().length > 0)
      .join(" ")
      .trim();

      const limit =
        typeof requestFilter.limit === "number" && Number.isFinite(requestFilter.limit)
          ? Math.max(1, Math.min(500, Math.trunc(requestFilter.limit)))
          : 500;

    try {
      const result = await provider.search({
        query,
        text: requestText,
        from: typeof requestFilter.from === "string" ? requestFilter.from : undefined,
        to: typeof requestFilter.to === "string" ? requestFilter.to : undefined,
        cc: typeof requestFilter.cc === "string" ? requestFilter.cc : undefined,
        fromEmails: Array.isArray(requestFilter.fromEmails)
          ? (requestFilter.fromEmails as string[])
          : undefined,
        fromDomains: Array.isArray(requestFilter.fromDomains)
          ? (requestFilter.fromDomains as string[])
          : undefined,
        toEmails: Array.isArray(requestFilter.toEmails)
          ? (requestFilter.toEmails as string[])
          : undefined,
        toDomains: Array.isArray(requestFilter.toDomains)
          ? (requestFilter.toDomains as string[])
          : undefined,
        ccEmails: Array.isArray(requestFilter.ccEmails)
          ? (requestFilter.ccEmails as string[])
          : undefined,
        ccDomains: Array.isArray(requestFilter.ccDomains)
          ? (requestFilter.ccDomains as string[])
          : undefined,
        category:
          requestFilter.category === "primary" ||
          requestFilter.category === "promotions" ||
          requestFilter.category === "social" ||
          requestFilter.category === "updates" ||
          requestFilter.category === "forums"
            ? requestFilter.category
            : undefined,
        hasAttachment:
          typeof requestFilter.hasAttachment === "boolean"
            ? requestFilter.hasAttachment
            : undefined,
        attachmentMimeTypes: Array.isArray(requestFilter.attachmentMimeTypes)
          ? (requestFilter.attachmentMimeTypes as string[])
          : undefined,
        attachmentFilenameContains:
          typeof requestFilter.attachmentFilenameContains === "string"
            ? requestFilter.attachmentFilenameContains
            : undefined,
        includeNonPrimary:
          typeof requestFilter.includeNonPrimary === "boolean"
            ? requestFilter.includeNonPrimary
            : undefined,
        ...(resolvedBounds.after ? { after: resolvedBounds.after } : {}),
        ...(resolvedBounds.before ? { before: resolvedBounds.before } : {}),
        limit,
        fetchAll: true,
      });

      const minimumCount = result.messages.length;
      const totalEstimate =
        typeof result.totalEstimate === "number" && Number.isFinite(result.totalEstimate)
          ? Math.max(minimumCount, Math.trunc(result.totalEstimate))
          : undefined;
      const truncated = Boolean(result.nextPageToken);
      const exact = !truncated;
      const count = exact ? minimumCount : totalEstimate ?? minimumCount;

      return {
        success: true,
        data: {
          count,
          exact,
          minimumCount,
          scope,
          source: exact ? "search_scan" : totalEstimate ? "search_estimate" : "search_partial",
          asOf: new Date().toISOString(),
        },
        message: exact
          ? `Found ${count} unread email${count === 1 ? "" : "s"} for that window.`
          : totalEstimate
            ? `Found about ${count} unread email${count === 1 ? "" : "s"} for that window.`
            : `Found at least ${minimumCount} unread email${minimumCount === 1 ? "" : "s"} in the scanned portion.`,
        truncated,
        paging: {
          nextPageToken: result.nextPageToken ?? null,
          totalEstimate: totalEstimate ?? minimumCount,
          coverage: {
            completeness: truncated ? "partial" : "complete",
            mailboxScope: scope,
          },
        },
        evidence: {
          domain: "email",
          observedAt: new Date().toISOString(),
          scope,
          coverage: truncated ? "partial" : "complete",
          reusableForFollowUp: !truncated,
          staleAfterSec: 120,
        },
        meta: asMetaItemCount(1),
      };
    } catch (error) {
      return capabilityFailureResult(error, "I couldn't count unread emails for that window.", {
        resource: "email",
      });
    }
  };

  const runBulkIds = async (
    filter: Record<string, unknown>,
  ): Promise<string[]> => {
    const search = await runUnifiedSearchThreads({
      ...filter,
      subscriptionsOnly: Boolean(filter.subscriptionsOnly),
      limit: typeof filter.limit === "number" ? filter.limit : 500,
      fetchAll: true,
    });

    const items = Array.isArray(search.data) ? search.data : [];
    return items
      .map((item) =>
        item && typeof item === "object"
          ? (item as Record<string, unknown>).id
          : undefined,
      )
      .filter((id): id is string => typeof id === "string" && id.length > 0);
  };

  const resolveMutationTargets = async (input: {
    ids?: unknown;
    filter?: unknown;
    limit?: unknown;
  }): Promise<{ ok: true; ids: string[] } | { ok: false; result: ToolResult }> => {
    const rawIds = Array.isArray(input.ids)
      ? input.ids.filter((id): id is string => typeof id === "string")
      : [];

    if (rawIds.length > 0) {
      const ids = uniqueIds(rawIds);
      if (ids.length === 0) {
        return {
          ok: false,
          result: {
            success: false,
            error: "invalid_input:no ids",
            clarification: {
              kind: "missing_fields",
              prompt: "email_bulk_target_required",
              missingFields: ["ids"],
            },
          },
        };
      }
      return { ok: true, ids };
    }

    const filter =
      input.filter && typeof input.filter === "object" && !Array.isArray(input.filter)
        ? (input.filter as Record<string, unknown>)
        : null;
    if (!filter) {
      return {
        ok: false,
        result: {
          success: false,
          error: "invalid_input:missing_ids_or_filter",
          clarification: {
            kind: "missing_fields",
            prompt: "email_bulk_target_required",
            missingFields: ["ids_or_filter"],
          },
        },
      };
    }

    const limit =
      typeof input.limit === "number" && Number.isFinite(input.limit)
        ? Math.max(1, Math.trunc(input.limit))
        : undefined;

    const ids = await runBulkIds({
      ...filter,
      ...(limit ? { limit } : {}),
    });

    if (ids.length === 0) {
      return {
        ok: false,
        result: {
          success: false,
          error: "no_matching_emails",
          message: "No matching emails found for that request.",
          meta: asMetaItemCount(0),
        },
      };
    }

    return { ok: true, ids };
  };

  return {
    async countUnread(filter) {
      return runCountUnread(filter);
    },

    async search(filter) {
      return runUnifiedSearchThreads(filter);
    },

    async facetThreads(input) {
      const rawFilter =
        input.filter && typeof input.filter === "object" && !Array.isArray(input.filter)
          ? (input.filter as Record<string, unknown>)
          : {};

      const validatedFilter = validateEmailSearchFilter(rawFilter);
      if (!validatedFilter.ok) {
        return {
          success: false,
          error: validatedFilter.error,
          message: validatedFilter.message,
          clarification: {
            kind: validatedFilter.clarificationKind ?? "invalid_fields",
            prompt: validatedFilter.prompt,
            missingFields: validatedFilter.fields,
          },
          data: validatedFilter.concept ? { concept: validatedFilter.concept } : undefined,
        };
      }

      const filter = validatedFilter.filter;
      const hasAnyConstraint = Boolean(
        (typeof filter.query === "string" && filter.query.trim()) ||
          (typeof filter.text === "string" && filter.text.trim()) ||
          (typeof filter.from === "string" && filter.from.trim()) ||
          (typeof filter.to === "string" && filter.to.trim()) ||
          (typeof filter.cc === "string" && filter.cc.trim()) ||
          (Array.isArray(filter.fromEmails) && filter.fromEmails.length > 0) ||
          (Array.isArray(filter.fromDomains) && filter.fromDomains.length > 0) ||
          (Array.isArray(filter.toEmails) && filter.toEmails.length > 0) ||
          (Array.isArray(filter.toDomains) && filter.toDomains.length > 0) ||
          (Array.isArray(filter.ccEmails) && filter.ccEmails.length > 0) ||
          (Array.isArray(filter.ccDomains) && filter.ccDomains.length > 0) ||
          (filter.dateRange && typeof filter.dateRange === "object") ||
          typeof filter.unread === "boolean" ||
          typeof filter.hasAttachment === "boolean" ||
          typeof filter.category === "string",
      );

      if (!hasAnyConstraint) {
        return {
          success: false,
          error: "clarification_required",
          clarification: {
            kind: "missing_fields",
            prompt: "email_facet_target_required",
            missingFields: ["filter"],
          },
        };
      }

      const scanLimit =
        typeof input.scanLimit === "number" && Number.isFinite(input.scanLimit)
          ? Math.max(20, Math.min(300, Math.trunc(input.scanLimit)))
          : 150;

      const requestQuery =
        typeof filter.query === "string" && filter.query.trim().length > 0
          ? filter.query.trim()
          : undefined;
      const requestText =
        typeof filter.text === "string" && filter.text.trim().length > 0
          ? filter.text.trim()
          : undefined;
      const semanticQuery = requestQuery ?? requestText ?? undefined;
      const resolvedBounds = await resolveProviderDateBounds(filter);
      if (!resolvedBounds.ok) {
        return {
          success: false,
          error: "invalid_date_range",
          message: resolvedBounds.error,
          clarification: {
            kind: "invalid_fields",
            prompt: "email_date_range_invalid",
            missingFields: ["dateRange.after", "dateRange.before"],
          },
        };
      }

      const search = await provider.search({
        query: semanticQuery ?? "",
        text: requestText,
        from: typeof filter.from === "string" ? filter.from : undefined,
        to: typeof filter.to === "string" ? filter.to : undefined,
        cc: typeof filter.cc === "string" ? filter.cc : undefined,
        fromEmails: Array.isArray(filter.fromEmails) ? (filter.fromEmails as string[]) : undefined,
        fromDomains: Array.isArray(filter.fromDomains) ? (filter.fromDomains as string[]) : undefined,
        toEmails: Array.isArray(filter.toEmails) ? (filter.toEmails as string[]) : undefined,
        toDomains: Array.isArray(filter.toDomains) ? (filter.toDomains as string[]) : undefined,
        ccEmails: Array.isArray(filter.ccEmails) ? (filter.ccEmails as string[]) : undefined,
        ccDomains: Array.isArray(filter.ccDomains) ? (filter.ccDomains as string[]) : undefined,
        category:
          filter.category === "primary" ||
          filter.category === "promotions" ||
          filter.category === "social" ||
          filter.category === "updates" ||
          filter.category === "forums"
            ? filter.category
            : undefined,
        hasAttachment: typeof filter.hasAttachment === "boolean" ? (filter.hasAttachment as boolean) : undefined,
        attachmentMimeTypes: Array.isArray(filter.attachmentMimeTypes) ? (filter.attachmentMimeTypes as string[]) : undefined,
        attachmentFilenameContains: typeof filter.attachmentFilenameContains === "string" ? filter.attachmentFilenameContains : undefined,
        ...(resolvedBounds.after ? { after: resolvedBounds.after } : {}),
        ...(resolvedBounds.before ? { before: resolvedBounds.before } : {}),
        limit: scanLimit,
        fetchAll: false,
      });

      const messages = search.messages.map((message) => ({
        from: message.headers?.from ?? "",
        threadId: message.threadId ?? "",
      }));
      const maxFacets =
        typeof input.maxFacets === "number" && Number.isFinite(input.maxFacets)
          ? Math.max(3, Math.min(25, Math.trunc(input.maxFacets)))
          : 10;

      const senderCounts = new Map<string, { count: number; sampleThreadIds: string[] }>();
      const domainCounts = new Map<string, { count: number; sampleThreadIds: string[] }>();

      for (const message of messages) {
        const fromHeader = message.from ?? "";
        const emails = extractEmailAddresses(fromHeader).map((e) => e.toLowerCase());
        const threadId = message.threadId ?? "";
        for (const email of emails.slice(0, 1)) {
          const current = senderCounts.get(email) ?? { count: 0, sampleThreadIds: [] };
          current.count += 1;
          if (threadId && current.sampleThreadIds.length < 5 && !current.sampleThreadIds.includes(threadId)) {
            current.sampleThreadIds.push(threadId);
          }
          senderCounts.set(email, current);

          const domain = email.split("@")[1] ?? "";
          if (domain) {
            const domCurrent = domainCounts.get(domain) ?? { count: 0, sampleThreadIds: [] };
            domCurrent.count += 1;
            if (threadId && domCurrent.sampleThreadIds.length < 5 && !domCurrent.sampleThreadIds.includes(threadId)) {
              domCurrent.sampleThreadIds.push(threadId);
            }
            domainCounts.set(domain, domCurrent);
          }
        }
      }

      const topSenders = Array.from(senderCounts.entries())
        .sort((a, b) => b[1].count - a[1].count)
        .slice(0, maxFacets)
        .map(([email, stats]) => ({ email, count: stats.count, sampleThreadIds: stats.sampleThreadIds }));
      const topDomains = Array.from(domainCounts.entries())
        .sort((a, b) => b[1].count - a[1].count)
        .slice(0, maxFacets)
        .map(([domain, stats]) => ({ domain, count: stats.count, sampleThreadIds: stats.sampleThreadIds }));

      return {
        success: true,
        data: {
          scannedMessages: messages.length,
          topSenders,
          topDomains,
        },
        evidence: {
          domain: "email",
          observedAt: new Date().toISOString(),
          scope: "facet",
          coverage: "partial",
          reusableForFollowUp: false,
          staleAfterSec: 180,
        },
        meta: asMetaItemCount(topSenders.length + topDomains.length),
      };
    },

    async getThreadMessages(threadId) {
      try {
        const thread = await getEmailThread(provider, threadId);
        const messages = Array.isArray(thread.messages) ? thread.messages : [];
        return {
          success: true,
          data: { threadId, messages, snippet: thread.snippet },
          meta: asMetaItemCount(messages.length),
          message: `Loaded ${messages.length} messages from the thread.`,
        };
      } catch (error) {
        return capabilityFailureResult(error, "I couldn't load that thread right now.", {
          resource: "email",
        });
      }
    },

    async getMessagesBatch(ids) {
      const normalized = uniqueIds(ids);
      if (normalized.length === 0) {
        return {
          success: false,
          error: "invalid_input:no ids provided",
          message: "I need at least one message id.",
          clarification: {
            kind: "missing_fields",
            prompt: "email_message_id_required",
            missingFields: ["message_ids"],
          },
        };
      }
      try {
        const messages = await getEmailMessages(provider, normalized);
        return {
          success: true,
          data: messages,
          meta: asMetaItemCount(messages.length),
          message: `Loaded ${messages.length} messages.`,
        };
      } catch (error) {
        return capabilityFailureResult(error, "I couldn't load those messages right now.", {
          resource: "email",
          requestedIds: normalized,
        });
      }
    },

    async getLatestMessage(threadId) {
      try {
        const thread = await getEmailThread(provider, threadId);
        const messages = [...thread.messages].sort((a, b) => {
          const aMs = a.date ? new Date(a.date).getTime() : 0;
          const bMs = b.date ? new Date(b.date).getTime() : 0;
          return bMs - aMs;
        });
        const latest = messages[0] ?? null;
        return {
          success: true,
          data: latest,
          meta: asMetaItemCount(latest ? 1 : 0),
          message: latest
            ? "Loaded the latest message in that thread."
            : "No messages were found in that thread.",
        };
      } catch (error) {
        return capabilityFailureResult(error, "I couldn't fetch the latest message right now.", {
          resource: "email",
        });
      }
    },

    async batchArchive(input) {
      const resolved = await resolveMutationTargets(input);
      if (!resolved.ok) return resolved.result;
      const messageIds = await coerceToMessageIds(capEnv, resolved.ids);
      if (messageIds.length === 0) {
        return {
          success: false,
          error: "invalid_input:no message ids",
          clarification: {
            kind: "missing_fields",
            prompt: "email_archive_target_required",
            missingFields: ["thread_ids"],
          },
        };
      }
      try {
        const result = await modifyEmailMessages(provider, messageIds, { archive: true });
        return {
          success: result.success,
          data: { count: result.count },
          message: `Archived ${result.count} thread${result.count === 1 ? "" : "s"}.`,
          meta: asMetaItemCount(result.count),
        };
      } catch (error) {
        return capabilityFailureResult(error, "I couldn't archive those emails right now.", {
          resource: "email",
        });
      }
    },

    async batchTrash(input) {
      const resolved = await resolveMutationTargets(input);
      if (!resolved.ok) return resolved.result;
      const messageIds = await coerceToMessageIds(capEnv, resolved.ids);
      if (messageIds.length === 0) {
        return {
          success: false,
          error: "invalid_input:no message ids",
          clarification: {
            kind: "missing_fields",
            prompt: "email_trash_target_required",
            missingFields: ["thread_ids"],
          },
        };
      }
      try {
        const result = await trashEmailMessages(provider, messageIds);
        return {
          success: result.success,
          data: { count: result.count },
          message: `Moved ${result.count} thread${result.count === 1 ? "" : "s"} to trash.`,
          meta: asMetaItemCount(result.count),
        };
      } catch (error) {
        return capabilityFailureResult(error, "I couldn't trash those emails right now.", {
          resource: "email",
        });
      }
    },

    async markReadUnread(input) {
      const resolved = await resolveMutationTargets(input);
      if (!resolved.ok) return resolved.result;
      const messageIds = await coerceToMessageIds(capEnv, resolved.ids);
      const read = Boolean(input.read);
      if (messageIds.length === 0) {
        return {
          success: false,
          error: "invalid_input:no message ids",
          clarification: {
            kind: "missing_fields",
            prompt: "email_mark_read_target_required",
            missingFields: ["thread_ids"],
          },
        };
      }
      try {
        const result = await modifyEmailMessages(provider, messageIds, { read });
        return {
          success: result.success,
          data: { count: result.count, read },
          message: read
            ? `Marked ${result.count} thread${result.count === 1 ? "" : "s"} as read.`
            : `Marked ${result.count} thread${result.count === 1 ? "" : "s"} as unread.`,
          meta: asMetaItemCount(result.count),
        };
      } catch (error) {
        return capabilityFailureResult(error, "I couldn't update read state right now.", {
          resource: "email",
        });
      }
    },

    async applyLabels(input) {
      const resolved = await resolveMutationTargets(input);
      if (!resolved.ok) return resolved.result;
      const messageIds = await coerceToMessageIds(capEnv, resolved.ids);
      const normalizedLabels = uniqueIds(Array.isArray(input.labelIds) ? input.labelIds : []);
      if (messageIds.length === 0 || normalizedLabels.length === 0) {
        return {
          success: false,
          error: "invalid_input:missing ids or labels",
          clarification: {
            kind: "missing_fields",
            prompt: "email_apply_labels_target_required",
            missingFields: ["thread_ids", "label_ids"],
          },
        };
      }
      try {
        const result = await modifyEmailMessages(provider, messageIds, {
          labels: { add: normalizedLabels },
        });
        return {
          success: result.success,
          data: { count: result.count, labels: normalizedLabels },
          message: `Applied labels to ${result.count} thread${result.count === 1 ? "" : "s"}.`,
          meta: asMetaItemCount(result.count),
        };
      } catch (error) {
        return capabilityFailureResult(error, "I couldn't apply labels right now.", {
          resource: "email",
        });
      }
    },

    async removeLabels(input) {
      const resolved = await resolveMutationTargets(input);
      if (!resolved.ok) return resolved.result;
      const messageIds = await coerceToMessageIds(capEnv, resolved.ids);
      const normalizedLabels = uniqueIds(Array.isArray(input.labelIds) ? input.labelIds : []);
      if (messageIds.length === 0 || normalizedLabels.length === 0) {
        return {
          success: false,
          error: "invalid_input:missing ids or labels",
          clarification: {
            kind: "missing_fields",
            prompt: "email_remove_labels_target_required",
            missingFields: ["thread_ids", "label_ids"],
          },
        };
      }
      try {
        const result = await modifyEmailMessages(provider, messageIds, {
          labels: { remove: normalizedLabels },
        });
        return {
          success: result.success,
          data: { count: result.count, labels: normalizedLabels },
          message: `Removed labels from ${result.count} thread${result.count === 1 ? "" : "s"}.`,
          meta: asMetaItemCount(result.count),
        };
      } catch (error) {
        return capabilityFailureResult(error, "I couldn't remove labels right now.", {
          resource: "email",
        });
      }
    },

    async moveThread(input) {
      const resolved = await resolveMutationTargets(input);
      if (!resolved.ok) return resolved.result;
      const threadIds = await coerceToThreadIds(capEnv, resolved.ids);
      const folderName = String(input.folderName ?? "");
      if (threadIds.length === 0 || !folderName.trim()) {
        return {
          success: false,
          error: "invalid_input:missing thread or folder",
          clarification: {
            kind: "missing_fields",
            prompt: "email_move_thread_target_required",
            missingFields: ["thread_ids", "folder_name"],
          },
        };
      }
      if (provider.name === "google") {
        return {
          success: false,
          error: "unsupported_operation",
          message: "Moving threads to folders is not supported for Gmail.",
          data: {
            provider: "google",
            operation: "moveThread",
          },
          meta: asMetaItemCount(0),
        };
      }
      try {
        for (const threadId of threadIds) {
          await provider.moveThreadToFolder(threadId, folderName.trim());
        }
        return {
          success: true,
          data: { count: threadIds.length, folderName: folderName.trim() },
          message: `Moved ${threadIds.length} thread${threadIds.length === 1 ? "" : "s"} to ${folderName.trim()}.`,
          meta: asMetaItemCount(threadIds.length),
        };
      } catch (error) {
        return capabilityFailureResult(error, "I couldn't move those emails right now.", {
          resource: "email",
        });
      }
    },

    async markSpam(ids) {
      const threadIds = await coerceToThreadIds(capEnv, ids);
      if (threadIds.length === 0) {
        return {
          success: false,
          error: "invalid_input:no thread ids",
          clarification: {
            kind: "missing_fields",
            prompt: "email_spam_target_required",
            missingFields: ["thread_ids"],
          },
        };
      }
      try {
        for (const threadId of threadIds) {
          await provider.markSpam(threadId);
        }
        return {
          success: true,
          data: { count: threadIds.length },
          message: `Marked ${threadIds.length} thread${threadIds.length === 1 ? "" : "s"} as spam.`,
          meta: asMetaItemCount(threadIds.length),
        };
      } catch (error) {
        return capabilityFailureResult(error, "I couldn't mark those emails as spam right now.", {
          resource: "email",
        });
      }
    },

    async unsubscribeSender(filterOrIds) {
      try {
        let targetIds: string[] = Array.isArray(filterOrIds.ids)
          ? filterOrIds.ids
          : [];
        if (targetIds.length === 0 && filterOrIds.filter) {
          targetIds = await runBulkIds({
            ...filterOrIds.filter,
            subscriptionsOnly: true,
          });
        }

        const messageIds = await coerceToMessageIds(capEnv, targetIds);
        if (messageIds.length === 0) {
          return {
            success: false,
            error: "invalid_input:no matching ids",
            clarification: {
              kind: "missing_fields",
              prompt: "email_unsubscribe_target_required",
              missingFields: ["sender_or_domain"],
            },
          };
        }

        for (const id of messageIds) {
          await provider.blockUnsubscribedEmail(id);
        }

        return {
          success: true,
          data: { count: messageIds.length },
          message:
            messageIds.length > 0
              ? `Applied unsubscribe/block actions to ${messageIds.length} email${messageIds.length === 1 ? "" : "s"}.`
              : "No emails were updated for unsubscribe.",
          meta: asMetaItemCount(messageIds.length),
        };
      } catch (error) {
        return capabilityFailureResult(
          error,
          "I couldn't apply unsubscribe controls right now.",
          { resource: "email" },
        );
      }
    },

    async blockSender(ids) {
      const messageIds = await coerceToMessageIds(capEnv, ids);
      if (messageIds.length === 0) {
        return {
          success: false,
          error: "invalid_input:no message ids",
          clarification: {
            kind: "missing_fields",
            prompt: "email_block_sender_target_required",
            missingFields: ["thread_ids"],
          },
        };
      }
      try {
        for (const id of messageIds) {
          await provider.blockUnsubscribedEmail(id);
        }
        return {
          success: true,
          data: { count: messageIds.length },
          message: `Blocked sender controls for ${messageIds.length} email${messageIds.length === 1 ? "" : "s"}.`,
          meta: asMetaItemCount(messageIds.length),
        };
      } catch (error) {
        return capabilityFailureResult(error, "I couldn't block those senders right now.", {
          resource: "email",
        });
      }
    },

    async bulkSenderArchive(filter) {
      const ids = await runBulkIds(filter);
      const messageIds = await coerceToMessageIds(capEnv, ids);
      if (messageIds.length === 0) {
        return {
          success: false,
          error: "invalid_input:no message ids",
          message: "No matching emails found for this sender action.",
        };
      }
      try {
        const result = await modifyEmailMessages(provider, messageIds, { archive: true });
        return {
          success: result.success,
          data: { count: result.count },
          message: `Archived ${result.count} sender-matched thread${result.count === 1 ? "" : "s"}.`,
          meta: asMetaItemCount(result.count),
        };
      } catch (error) {
        return capabilityFailureResult(error, "I couldn't archive sender-matched emails right now.", {
          resource: "email",
        });
      }
    },

    async bulkSenderTrash(filter) {
      const ids = await runBulkIds(filter);
      const messageIds = await coerceToMessageIds(capEnv, ids);
      if (messageIds.length === 0) {
        return {
          success: false,
          error: "invalid_input:no message ids",
          message: "No matching emails found for this sender action.",
        };
      }
      try {
        const result = await trashEmailMessages(provider, messageIds);
        return {
          success: result.success,
          data: { count: result.count },
          message: `Trashed ${result.count} sender-matched thread${result.count === 1 ? "" : "s"}.`,
          meta: asMetaItemCount(result.count),
        };
      } catch (error) {
        return capabilityFailureResult(error, "I couldn't trash sender-matched emails right now.", {
          resource: "email",
        });
      }
    },

    async bulkSenderLabel(filter) {
      const ids = await runBulkIds(filter.filter);
      const messageIds = await coerceToMessageIds(capEnv, ids);
      if (messageIds.length === 0 || !filter.labelId?.trim()) {
        return {
          success: false,
          error: "invalid_input:missing ids or label id",
          message: "I need matched emails and a label id for sender labeling.",
        };
      }
      try {
        const result = await modifyEmailMessages(provider, messageIds, {
          labels: { add: [filter.labelId.trim()] },
        });
        return {
          success: result.success,
          data: { count: result.count, labelId: filter.labelId.trim() },
          message: `Labeled ${result.count} sender-matched thread${result.count === 1 ? "" : "s"}.`,
          meta: asMetaItemCount(result.count),
        };
      } catch (error) {
        return capabilityFailureResult(error, "I couldn't label sender-matched emails right now.", {
          resource: "email",
        });
      }
    },

    async snoozeThread(ids, snoozeUntil) {
      if (!Array.isArray(ids) || ids.length === 0) {
        return {
          success: false,
          error: "invalid_input:no ids",
          clarification: {
            kind: "missing_fields",
            prompt: "email_snooze_target_required",
            missingFields: ["thread_ids"],
          },
        };
      }
      if (!snoozeUntil) {
        return {
          success: false,
          error: "invalid_input:missing defer-until",
          clarification: {
            kind: "missing_fields",
            prompt: "email_snooze_time_required",
            missingFields: ["defer_until"],
          },
        };
      }
      try {
        const messageIds = await coerceToMessageIds(capEnv, ids);
        const result = await modifyEmailMessages(provider, messageIds, {
          followUp: "enable",
          read: false,
        });
        return {
          success: result.success,
          data: { count: result.count, deferUntil: snoozeUntil },
          message: `Flagged ${result.count} thread${result.count === 1 ? "" : "s"} for follow-up at ${snoozeUntil}.`,
          meta: asMetaItemCount(result.count),
        };
      } catch (error) {
        return capabilityFailureResult(error, "I couldn't defer those threads right now.", {
          resource: "email",
        });
      }
    },

    async listFilters() {
      try {
        const filters = await provider.getFiltersList();
        return {
          success: true,
          data: filters,
          message:
            filters.length === 0
              ? "No filters found."
              : `Found ${filters.length} filter${filters.length === 1 ? "" : "s"}.`,
          meta: asMetaItemCount(filters.length),
        };
      } catch (error) {
        return capabilityFailureResult(error, "I couldn't list your filters right now.", {
          resource: "email",
        });
      }
    },

    async createFilter(input) {
      const from = input.from?.trim();
      if (!from) {
        return {
          success: false,
          error: "invalid_input:missing sender",
          clarification: {
            kind: "missing_fields",
            prompt: "email_filter_sender_required",
            missingFields: ["from"],
          },
        };
      }
      try {
        if (input.autoArchiveLabelName?.trim()) {
          const result = await provider.createAutoArchiveFilter({
            from,
            labelName: input.autoArchiveLabelName.trim(),
          });
          return {
            success: true,
            data: result,
            message: "Created auto-archive filter.",
            meta: { resource: "email", itemCount: 1 },
          };
        }

        const result = await provider.createFilter({
          from,
          addLabelIds: input.addLabelIds,
          removeLabelIds: input.removeLabelIds,
        });
        return {
          success: true,
          data: result,
          message: "Filter created.",
          meta: { resource: "email", itemCount: 1 },
        };
      } catch (error) {
        return capabilityFailureResult(error, "I couldn't create that filter right now.", {
          resource: "email",
        });
      }
    },

    async deleteFilter(id) {
      const filterId = String(id ?? "").trim();
      if (!filterId) {
        return {
          success: false,
          error: "invalid_input:missing filter id",
          clarification: {
            kind: "missing_fields",
            prompt: "email_filter_id_required",
            missingFields: ["filter_id"],
          },
        };
      }
      try {
        const result = await provider.deleteFilter(filterId);
        return {
          success: true,
          data: result,
          message: "Filter deleted.",
          meta: { resource: "email", itemCount: 1 },
        };
      } catch (error) {
        return capabilityFailureResult(error, "I couldn't delete that filter right now.", {
          resource: "email",
        });
      }
    },

    async listDrafts(limit = 25) {
      try {
        const drafts = await provider.getDrafts({ maxResults: limit });
        return {
          success: true,
          data: drafts,
          message:
            drafts.length === 0
              ? "No drafts found."
              : `Found ${drafts.length} draft${drafts.length === 1 ? "" : "s"}.`,
          meta: asMetaItemCount(drafts.length),
        };
      } catch (error) {
        return capabilityFailureResult(error, "I couldn't load drafts right now.", {
          resource: "email",
        });
      }
    },

    async getDraft(draftId) {
      const id = String(draftId ?? "").trim();
      if (!id) {
        return {
          success: false,
          error: "invalid_input:missing draft id",
          clarification: {
            kind: "missing_fields",
            prompt: "email_draft_id_required",
            missingFields: ["draft_id"],
          },
        };
      }
      try {
        const draft = await provider.getDraft(id);
        return {
          success: true,
          data: draft,
          message: draft ? "Draft loaded." : "Draft was not found.",
          meta: asMetaItemCount(draft ? 1 : 0),
        };
      } catch (error) {
        return capabilityFailureResult(error, "I couldn't load that draft right now.", {
          resource: "email",
        });
      }
    },

    async createDraft(input) {
      try {
        const draftType: "new" | "reply" | "forward" =
          input.type ?? (input.parentId ? "reply" : "new");

        if (
          draftType === "new" &&
          (!Array.isArray(input.to) || input.to.length === 0)
        ) {
          return {
            success: false,
            error: "recipient_missing",
          clarification: {
            kind: "missing_fields",
            prompt: "email_send_now_recipients_required",
            missingFields: ["recipient"],
          },
        };
      }

        const result = await provider.createDraft({
          type: draftType,
          ...(input.parentId ? { parentId: input.parentId } : {}),
          ...(Array.isArray(input.to) && input.to.length > 0
            ? { to: input.to }
            : {}),
          ...(Array.isArray(input.cc) && input.cc.length > 0
            ? { cc: input.cc }
            : {}),
          ...(Array.isArray(input.bcc) && input.bcc.length > 0
            ? { bcc: input.bcc }
            : {}),
          ...(input.subject ? { subject: input.subject } : {}),
          body: input.body,
        });

        return {
          success: true,
          data: {
            draftId: result.draftId,
            preview: result.preview,
          },
          message: "Draft created. You can review it before sending.",
          meta: asMetaItemCount(1),
        };
      } catch (error) {
        return capabilityFailureResult(error, "I couldn't create that draft right now.", {
          resource: "email",
        });
      }
    },

    async updateDraft(input) {
      const draftId = String(input.draftId ?? "").trim();
      if (!draftId) {
        return {
          success: false,
          error: "invalid_input:missing draft id",
          clarification: {
            kind: "missing_fields",
            prompt: "email_draft_id_required",
            missingFields: ["draft_id"],
          },
        };
      }

      if (!input.subject && !input.body) {
        return {
          success: false,
          error: "invalid_input:no update fields",
          clarification: {
            kind: "missing_fields",
            prompt: "email_draft_update_changes_required",
            missingFields: ["subject_or_body"],
          },
        };
      }

      try {
        await provider.updateDraft(draftId, {
          ...(input.subject ? { subject: input.subject } : {}),
          ...(input.body ? { messageHtml: input.body } : {}),
        });
        return {
          success: true,
          data: { draftId },
          message: "Draft updated.",
          meta: asMetaItemCount(1),
        };
      } catch (error) {
        return capabilityFailureResult(error, "I couldn't update that draft right now.", {
          resource: "email",
        });
      }
    },

    async deleteDraft(draftId) {
      const id = String(draftId ?? "").trim();
      if (!id) {
        return {
          success: false,
          error: "invalid_input:missing draft id",
          clarification: {
            kind: "missing_fields",
            prompt: "email_draft_id_required",
            missingFields: ["draft_id"],
          },
        };
      }
      try {
        await provider.deleteDraft(id);
        return {
          success: true,
          data: { draftId: id },
          message: "Draft deleted.",
          meta: asMetaItemCount(1),
        };
      } catch (error) {
        return capabilityFailureResult(error, "I couldn't delete that draft right now.", {
          resource: "email",
        });
      }
    },

    async sendDraft(draftId) {
      const id = String(draftId ?? "").trim();
      if (!id) {
        return {
          success: false,
          error: "invalid_input:missing draft id",
          clarification: {
            kind: "missing_fields",
            prompt: "email_draft_id_required",
            missingFields: ["draft_id"],
          },
        };
      }
      try {
        const result = await provider.sendDraft(id);
        return {
          success: true,
          data: result,
          message: "Draft sent.",
          meta: asMetaItemCount(1),
        };
      } catch (error) {
        return capabilityFailureResult(error, "I couldn't send that draft right now.", {
          resource: "email",
        });
      }
    },

    async sendNow(input) {
      if (input.draftId?.trim()) {
        try {
          const result = await provider.sendDraft(input.draftId.trim());
          return {
            success: true,
            data: result,
            message: "Draft sent.",
            meta: asMetaItemCount(1),
          };
        } catch (error) {
          return capabilityFailureResult(error, "I couldn't send that draft right now.", {
            resource: "email",
          });
        }
      }

      if (!input.to || input.to.length === 0 || !input.body?.trim()) {
        return {
          success: false,
          error: "invalid_input:missing send fields",
          clarification: {
            kind: "missing_fields",
            prompt: "email_send_now_missing_fields",
            missingFields: ["recipient", "body"],
          },
        };
      }

      try {
        const draft = await provider.createDraft({
          type: "new",
          to: input.to,
          subject: input.subject,
          body: input.body,
        });
        const sendResult = await provider.sendDraft(draft.draftId);
        return {
          success: true,
          data: sendResult,
          message: "Email sent.",
          meta: asMetaItemCount(1),
        };
      } catch (error) {
        return {
          success: false,
          error: `unknown:${error instanceof Error ? error.message : String(error)}`,
          message: "I couldn't send that email right now.",
        };
      }
    },

    async reply(input) {
      const parent = String(input.parentId ?? "").trim();
      if (!parent) {
        return {
          success: false,
          error: "invalid_input:missing_parent_id",
          clarification: {
            kind: "missing_fields",
            prompt: "email_reply_parent_required",
            missingFields: ["parentId"],
          },
        };
      }
      const body = String(input.body ?? "").trim();
      if (!body) {
        return {
          success: false,
          error: "invalid_input:missing_body",
          clarification: {
            kind: "missing_fields",
            prompt: "email_reply_body_required",
            missingFields: ["body"],
          },
        };
      }

      const mode: "send" | "draft" = input.mode === "draft" ? "draft" : "send";
      const replyAll = input.replyAll === true;

      type ParentMessage = {
        id?: string;
        internalDate?: string;
        date?: string;
        headers?: Record<string, string | undefined>;
      };

      let parentMessage: ParentMessage | null = null;
      try {
        const byId = await provider.get([parent]);
        parentMessage =
          Array.isArray(byId) && byId.length > 0
            ? (byId[0] as unknown as ParentMessage)
            : null;
      } catch {
        parentMessage = null;
      }

      if (!parentMessage) {
        try {
          const thread = await provider.getThread(parent);
          const messages = Array.isArray(thread.messages)
            ? (thread.messages as unknown as ParentMessage[])
            : [];
          parentMessage =
            messages.length > 0
              ? [...messages].sort((a, b) => {
                  const aMs = Date.parse(a.internalDate ?? a.date ?? "");
                  const bMs = Date.parse(b.internalDate ?? b.date ?? "");
                  return (Number.isFinite(bMs) ? bMs : 0) - (Number.isFinite(aMs) ? aMs : 0);
                })[0]
              : null;
        } catch {
          parentMessage = null;
        }
      }

      if (!parentMessage?.id) {
        return {
          success: false,
          error: "parent_not_found",
          message: "I couldn't find the email/thread to reply to.",
        };
      }

      const ownerEmail = (capEnv.runtime.email ?? "").trim().toLowerCase();
      const fromEmails = extractEmailAddresses(parentMessage.headers?.from ?? "");
      const replyToEmails = extractEmailAddresses(parentMessage.headers?.["reply-to"] ?? "");
      const primaryRecipient = (replyToEmails[0] ?? fromEmails[0] ?? "").trim();

      const toAddresses = replyAll
        ? (() => {
            const candidates = [
              primaryRecipient,
              ...extractEmailAddresses(parentMessage.headers?.to ?? ""),
            ]
              .map((v) => v.trim())
              .filter(Boolean);
            const set = new Set(
              candidates.filter((email) => email.toLowerCase() !== ownerEmail),
            );
            return Array.from(set);
          })()
        : primaryRecipient
          ? [primaryRecipient]
          : [];

      const ccAddresses = replyAll
        ? (() => {
            const candidates = [
              ...extractEmailAddresses(parentMessage.headers?.cc ?? ""),
              ...extractEmailAddresses(parentMessage.headers?.to ?? ""),
            ]
              .map((v) => v.trim())
              .filter(Boolean);
            const excluded = new Set(
              [ownerEmail, ...toAddresses.map((v) => v.toLowerCase())].filter(Boolean),
            );
            const set = new Set(
              candidates.filter((email) => !excluded.has(email.toLowerCase())),
            );
            return Array.from(set);
          })()
        : [];

      try {
        const draft = await provider.createDraft({
          type: "reply",
          parentId: parentMessage.id,
          ...(toAddresses.length > 0 ? { to: toAddresses } : {}),
          ...(ccAddresses.length > 0 ? { cc: ccAddresses } : {}),
          subject: input.subject,
          body,
        });

        if (mode === "draft") {
          return {
            success: true,
            data: {
              draftId: draft.draftId,
              preview: draft.preview,
            },
            message: "Draft reply created.",
            meta: asMetaItemCount(1),
          };
        }

        const sendResult = await provider.sendDraft(draft.draftId);
        return {
          success: true,
          data: sendResult,
          message: "Reply sent.",
          meta: asMetaItemCount(1),
        };
      } catch (error) {
        return capabilityFailureResult(error, "I couldn't send that reply right now.", {
          resource: "email",
        });
      }
    },

    async forward(input) {
      const parent = String(input.parentId ?? "").trim();
      if (!parent) {
        return {
          success: false,
          error: "parent_id_missing",
          clarification: {
            kind: "missing_fields",
            prompt: "email_forward_parent_required",
            missingFields: ["parentId"],
          },
        };
      }

      type ParentMessage = {
        id?: string;
        internalDate?: string;
        date?: string;
      };

      let parentMessage: ParentMessage | null = null;
      try {
        const byId = await provider.get([parent]);
        parentMessage =
          Array.isArray(byId) && byId.length > 0
            ? (byId[0] as unknown as ParentMessage)
            : null;
      } catch {
        parentMessage = null;
      }

      if (!parentMessage) {
        try {
          const thread = await provider.getThread(parent);
          const messages = Array.isArray(thread.messages)
            ? (thread.messages as unknown as ParentMessage[])
            : [];
          parentMessage =
            messages.length > 0
              ? [...messages].sort((a, b) => {
                  const aMs = Date.parse(a.internalDate ?? a.date ?? "");
                  const bMs = Date.parse(b.internalDate ?? b.date ?? "");
                  return (Number.isFinite(bMs) ? bMs : 0) - (Number.isFinite(aMs) ? aMs : 0);
                })[0]
              : null;
        } catch {
          parentMessage = null;
        }
      }

      if (!parentMessage?.id) {
        return {
          success: false,
          error: "parent_not_found",
          message: "I couldn't find the email/thread to forward.",
        };
      }

      try {
        const draft = await provider.createDraft({
          type: "forward",
          parentId: parentMessage.id,
          to: input.to,
          subject: input.subject,
          body: input.body ?? "",
        });
        const sendResult = await provider.sendDraft(draft.draftId);
        return {
          success: true,
          data: sendResult,
          message: "Email forwarded.",
          meta: asMetaItemCount(1),
        };
      } catch (error) {
        return capabilityFailureResult(error, "I couldn't forward that email right now.", {
          resource: "email",
        });
      }
    },

    async scheduleSend(_draftId, _sendAt) {
      const draftId = String(_draftId || "").trim();
      const sendAtRaw = String(_sendAt || "").trim();
      if (!draftId)
        return {
          success: false,
          error: "invalid_input:draft_id_missing",
          message: "Draft id is required.",
        };
      const resolvedTimeZone = await getDefaultTimeZone();
      if ("error" in resolvedTimeZone) {
        return {
          success: false,
          error: "invalid_time_zone",
          message: resolvedTimeZone.error,
          clarification: {
            kind: "invalid_fields",
            prompt: "email_schedule_send_timezone_required",
            missingFields: ["timeZone"],
          },
        };
      }
      const sendAt = parseDateBoundInTimeZone(
        sendAtRaw,
        resolvedTimeZone.timeZone,
        "start",
      );
      if (!sendAt) {
        return {
          success: false,
          error: "invalid_input:invalid_send_time",
          message:
            "Send time must be an ISO-8601 timestamp or local datetime in your integration timezone.",
        };
      }
      if (sendAt.getTime() < Date.now() + 30_000) {
        return {
          success: false,
          error: "invalid_input:send_time_in_past",
          message: "Send time must be at least 30 seconds in the future.",
        };
      }

      const notBefore = Math.floor(sendAt.getTime() / 1000);
      const deduplicationId = createCapabilityIdempotencyKey({
        scope: "message",
        userId: capEnv.runtime.userId,
        emailAccountId: capEnv.runtime.emailAccountId,
        capability: "email.scheduleSend",
        seed: `${draftId}:${notBefore}`,
        payload: { draftId, notBefore },
      });

      try {
        const scheduledDraftSend = await (async () => {
          try {
            return await prisma.scheduledDraftSend.create({
              data: {
                userId: capEnv.runtime.userId,
                emailAccountId: capEnv.runtime.emailAccountId,
                draftId,
                sendAt,
                idempotencyKey: deduplicationId,
                status: "PENDING",
                ...(capEnv.runtime.conversationId
                  ? { sourceConversationId: capEnv.runtime.conversationId }
                  : {}),
              },
            });
          } catch (error: unknown) {
            // If we already scheduled this draft+timestamp, return the existing row deterministically.
            if (
              error instanceof Prisma.PrismaClientKnownRequestError &&
              error.code === "P2002"
            ) {
              const existing = await prisma.scheduledDraftSend.findUnique({
                where: { idempotencyKey: deduplicationId },
              });
              if (existing) return existing;
            }
            throw error;
          }
        })();

        let qstashMessageId: string | null = null;
        if (appEnv.QSTASH_TOKEN) {
          const client = new Client({ token: appEnv.QSTASH_TOKEN });
          const url = `${getInternalApiUrl()}/api/drafts/schedule-send/execute`;
          const response = await client.publishJSON({
            url,
            body: {
              emailAccountId: capEnv.runtime.emailAccountId,
              draftId,
            },
            notBefore,
            deduplicationId,
            contentBasedDeduplication: false,
            headers: getCronSecretHeader(),
            retries: 3,
          });
          qstashMessageId =
            response && typeof response === "object" && "messageId" in response
              ? (response.messageId as string | undefined) ?? null
              : null;

          if (qstashMessageId) {
            await prisma.scheduledDraftSend.update({
              where: { id: scheduledDraftSend.id },
              data: { scheduledId: qstashMessageId },
            });
          }
        }

        return {
          success: true,
          data: {
            scheduleId: scheduledDraftSend.id,
            scheduledId: qstashMessageId,
            sendAt: sendAt.toISOString(),
            idempotencyKey: deduplicationId,
          },
          message: `Scheduled. It will send at ${sendAt.toISOString()}.`,
          meta: asMetaItemCount(1),
        };
      } catch (error) {
        const classified = classifyCapabilityError(error);
        return {
          success: false,
          error: classified.code,
          message: "I couldn't schedule that send right now.",
          meta: {
            resource: "email",
            capabilityErrorMessage: classified.message,
          },
        };
      }
    },
  };
}
