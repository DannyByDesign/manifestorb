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
import { createUnifiedSearchService } from "@/server/features/search/unified/service";
import { createCapabilityIdempotencyKey } from "@/server/features/ai/tools/runtime/capabilities/idempotency";
import {
  getEmailMessages,
  getEmailThread,
  modifyEmailMessages,
  trashEmailMessages,
} from "@/server/features/ai/tools/email/primitives";
import {
  lookupSearchDocumentIds,
  lookupSearchAliasExpansions,
  recordSearchSignals,
} from "@/server/features/search/index/repository";
import { extractEmailAddresses } from "@/server/lib/email";
import prisma from "@/server/db/client";
import { Prisma } from "@/generated/prisma/client";

export interface EmailCapabilities {
  getUnreadCount(filter?: Record<string, unknown>): Promise<ToolResult>;
  searchThreads(filter: Record<string, unknown>): Promise<ToolResult>;
  searchThreadsAdvanced(filter: Record<string, unknown>): Promise<ToolResult>;
  facetThreads(input: { filter?: Record<string, unknown>; maxFacets?: number; scanLimit?: number }): Promise<ToolResult>;
  searchSent(filter: Record<string, unknown>): Promise<ToolResult>;
  searchInbox(filter: Record<string, unknown>): Promise<ToolResult>;
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

  const unifiedSearch = createUnifiedSearchService({
    userId: capEnv.runtime.userId,
    emailAccountId: capEnv.runtime.emailAccountId,
    email: capEnv.runtime.email,
    logger: capEnv.runtime.logger,
    providers: capEnv.toolContext.providers,
  });

  const recordEmailInteractionSignal = async (params: {
    signalType: "result_open" | "result_action";
    signalValue?: number;
    threadId?: string;
    messageIds?: string[];
    metadata?: Record<string, unknown>;
  }) => {
    const sourceIds = Array.isArray(params.messageIds)
      ? params.messageIds
      : [];
    const sourceParentIds = params.threadId ? [params.threadId] : [];

    if (sourceIds.length === 0 && sourceParentIds.length === 0) return;

    try {
      const documentIds = await lookupSearchDocumentIds({
        userId: capEnv.runtime.userId,
        emailAccountId: capEnv.runtime.emailAccountId,
        connector: "email",
        sourceIds,
        sourceParentIds,
        limit: 200,
      });
      if (documentIds.length === 0) return;

      await recordSearchSignals({
        userId: capEnv.runtime.userId,
        emailAccountId: capEnv.runtime.emailAccountId,
        signalType: params.signalType,
        signalValue: params.signalValue ?? 1,
        documentIds,
        metadata: params.metadata,
      });
    } catch (error) {
      capEnv.runtime.logger.warn("Failed to record email interaction signal", {
        userId: capEnv.runtime.userId,
        emailAccountId: capEnv.runtime.emailAccountId,
        signalType: params.signalType,
        error,
      });
    }
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

    const currentMessage = capEnv.toolContext.currentMessage ?? "";
    const queryText = [
      typeof requestFilter.query === "string" ? requestFilter.query : "",
      typeof requestFilter.text === "string" ? requestFilter.text : "",
      currentMessage,
    ]
      .join(" ")
      .trim();
    const lowerQueryText = queryText.toLowerCase();
    const fallbackQuery = currentMessage.trim();

    const inferredUnrepliedToSent =
      requestFilter.unrepliedToSent === true;
    const inferredPdfOnly =
      /\bpdf\b/u.test(lowerQueryText) &&
      (requestFilter.hasAttachment === true ||
        /\battach(?:ment|ments)\b/u.test(lowerQueryText));
    const inferredCc =
      typeof requestFilter.cc === "string" && requestFilter.cc.trim().length > 0
        ? requestFilter.cc.trim()
        : (() => {
            const match = lowerQueryText.match(
              /\bcc['’]?(?:d)?\s*(?:by|from)?\s*([^\s,<>()]+@[^\s,<>()]+\.[^\s,<>()]+)/u,
            );
            return match?.[1]?.trim();
          })();

    const mailbox =
      mailboxOverride ??
      (typeof requestFilter.mailbox === "string" ? requestFilter.mailbox : undefined) ??
      (requestFilter.sentByMe === true ? "sent" : undefined);

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
    const requestCc =
      typeof requestFilter.cc === "string" ? requestFilter.cc : inferredCc;

    const tryResolveSingleEmail = async (value: string | undefined): Promise<string[] | undefined> => {
      const raw = (value ?? "").trim();
      if (!raw) return undefined;
      if (raw.includes("@")) return undefined;
      if (/^[^\s@]+\.[^\s@]+$/u.test(raw)) return undefined;
      try {
        const aliasRows = await lookupSearchAliasExpansions({
          userId: capEnv.runtime.userId,
          emailAccountId: capEnv.runtime.emailAccountId,
          terms: [raw],
          limit: 40,
        });
        const candidates = Array.from(
          new Set(
            aliasRows
              .filter((row) => row.entityType === "person")
              .map((row) => row.canonicalValue)
              .filter((v) => typeof v === "string" && v.includes("@")),
          ),
        );
        return candidates.length === 1 ? candidates.slice(0, 1) : undefined;
      } catch {
        return undefined;
      }
    };

    const fromEmails =
      (Array.isArray(requestFilter.fromEmails) && requestFilter.fromEmails.length > 0
        ? (requestFilter.fromEmails as string[])
        : undefined) ?? (await tryResolveSingleEmail(requestFrom));
    const fromDomains =
      Array.isArray(requestFilter.fromDomains) && requestFilter.fromDomains.length > 0
        ? (requestFilter.fromDomains as string[])
        : undefined;
    const toEmails =
      (Array.isArray(requestFilter.toEmails) && requestFilter.toEmails.length > 0
        ? (requestFilter.toEmails as string[])
        : undefined) ?? (await tryResolveSingleEmail(requestTo));
    const toDomains =
      Array.isArray(requestFilter.toDomains) && requestFilter.toDomains.length > 0
        ? (requestFilter.toDomains as string[])
        : undefined;
    const ccEmails =
      (Array.isArray(requestFilter.ccEmails) && requestFilter.ccEmails.length > 0
        ? (requestFilter.ccEmails as string[])
        : undefined) ?? (await tryResolveSingleEmail(requestCc));
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
        capEnv.runtime.logger.warn("unrepliedToSent query failed; falling back to unified search scan", {
          userId: capEnv.runtime.userId,
          emailAccountId: capEnv.runtime.emailAccountId,
          error,
        });

        try {
          const requestQuery =
            typeof requestFilter.query === "string" && requestFilter.query.trim().length > 0
              ? requestFilter.query.trim()
              : undefined;
          const requestText =
            typeof requestFilter.text === "string" && requestFilter.text.trim().length > 0
              ? requestFilter.text.trim()
              : undefined;
          const semanticQuery =
            requestQuery ?? requestText ?? (fallbackQuery.length > 0 ? fallbackQuery : undefined);

          const search = await unifiedSearch.query({
            scopes: ["email"],
            mailbox: "sent",
            query: semanticQuery,
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
            attachmentMimeTypes: inferredPdfOnly
              ? ["application/pdf", "pdf"]
              : Array.isArray(requestFilter.attachmentMimeTypes)
                ? (requestFilter.attachmentMimeTypes as string[])
                : undefined,
            attachmentFilenameContains:
              typeof requestFilter.attachmentFilenameContains === "string"
                ? requestFilter.attachmentFilenameContains
                : undefined,
            dateRange: dateRange
              ? {
                  after:
                    typeof dateRange.after === "string" ? dateRange.after : undefined,
                  before:
                    typeof dateRange.before === "string" ? dateRange.before : undefined,
                  timeZone:
                    typeof dateRange.timeZone === "string"
                      ? dateRange.timeZone
                      : typeof dateRange.timezone === "string"
                        ? dateRange.timezone
                        : typeof requestFilter.timeZone === "string"
                          ? requestFilter.timeZone
                          : typeof requestFilter.timezone === "string"
                            ? requestFilter.timezone
                            : undefined,
                }
              : undefined,
            sort: "newest",
            limit: 120,
            fetchAll: false,
          });

          const ownerEmail = (capEnv.runtime.email ?? "").trim().toLowerCase();
          const threadIds = Array.from(
            new Set(
              search.items
                .filter((item) => item.surface === "email")
                .map((item) => {
                  const metadata =
                    item.metadata && typeof item.metadata === "object"
                      ? (item.metadata as Record<string, unknown>)
                      : {};
                  const threadId =
                    typeof metadata.threadId === "string"
                      ? metadata.threadId
                      : typeof metadata.sourceParentId === "string"
                        ? metadata.sourceParentId
                        : null;
                  return threadId;
                })
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

      // Preserve the full user turn for intent compilation when tool args are underspecified.
      // This prevents ranking/filter constraints (e.g. recency/unread) from being dropped.
      const semanticQuery =
        requestQuery ?? requestText ?? (fallbackQuery.length > 0 ? fallbackQuery : undefined);

      const result = await unifiedSearch.query({
        scopes: ["email"],
        mailbox:
          mailbox === "inbox" || mailbox === "sent"
            ? mailbox
            : undefined,
        query: semanticQuery,
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
        unread:
          typeof requestFilter.unread === "boolean"
            ? requestFilter.unread
            : undefined,
        hasAttachment:
          typeof requestFilter.hasAttachment === "boolean"
            ? requestFilter.hasAttachment
            : undefined,
        attachmentMimeTypes: inferredPdfOnly
          ? ["application/pdf", "pdf"]
          : Array.isArray(requestFilter.attachmentMimeTypes)
            ? (requestFilter.attachmentMimeTypes as string[])
            : undefined,
        attachmentFilenameContains:
          typeof requestFilter.attachmentFilenameContains === "string"
            ? requestFilter.attachmentFilenameContains
            : undefined,
        sort:
          requestFilter.sort === "relevance" ||
          requestFilter.sort === "newest" ||
          requestFilter.sort === "oldest"
            ? requestFilter.sort
            : undefined,
        dateRange: dateRange
          ? {
              after:
                typeof dateRange.after === "string" ? dateRange.after : undefined,
              before:
                typeof dateRange.before === "string" ? dateRange.before : undefined,
              timeZone:
                typeof dateRange.timeZone === "string"
                  ? dateRange.timeZone
                  : typeof dateRange.timezone === "string"
                    ? dateRange.timezone
                    : typeof requestFilter.timeZone === "string"
                      ? requestFilter.timeZone
                      : typeof requestFilter.timezone === "string"
                        ? requestFilter.timezone
                        : undefined,
            }
          : undefined,
        limit:
          typeof requestFilter.limit === "number" && Number.isFinite(requestFilter.limit)
            ? requestFilter.limit
            : undefined,
        fetchAll: Boolean(requestFilter.fetchAll),
      });

      if (result.queryPlan?.needsClarification) {
        return {
          success: false,
          error: "clarification_required",
          clarification: {
            kind: "missing_fields",
            prompt: result.queryPlan.clarificationPrompt ?? "search_target_unclear",
            missingFields: ["query"],
          },
        };
      }

      const data = result.items
        .filter((item) => item.surface === "email")
        .map((item) => {
          const metadata =
            item.metadata && typeof item.metadata === "object"
              ? (item.metadata as Record<string, unknown>)
              : {};
          return {
            id:
              typeof metadata.messageId === "string"
                ? metadata.messageId
                : item.id,
            threadId:
              typeof metadata.threadId === "string"
                ? metadata.threadId
                : null,
            title: item.title,
            snippet: item.snippet,
            date: item.timestamp ?? null,
            from:
              typeof metadata.from === "string" ? metadata.from : "",
            to: typeof metadata.to === "string" ? metadata.to : "",
            hasAttachment: metadata.hasAttachment === true,
            attachmentNames: Array.isArray(metadata.attachmentNames)
              ? metadata.attachmentNames
              : [],
            score: item.score,
          };
        });

      return {
        success: true,
        data,
        message:
          data.length === 0
            ? "No matching emails found."
            : `Found ${data.length} matching email${data.length === 1 ? "" : "s"}.`,
        truncated: result.truncated,
        paging: {
          nextPageToken: null,
          totalEstimate: result.total,
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
    const scopeRaw =
      typeof filter?.scope === "string"
        ? filter.scope.trim().toLowerCase()
        : "inbox";
    if (scopeRaw.length > 0 && scopeRaw !== "inbox") {
      return {
        success: false,
        error: "invalid_scope",
        message: "Unread count currently supports inbox scope only.",
        clarification: {
          kind: "invalid_fields",
          prompt: "email_unread_count_scope_invalid",
          missingFields: ["scope"],
        },
      };
    }

    try {
      const result = await provider.getUnreadCount({ scope: "inbox" });
      const count = Math.max(0, Math.trunc(result.count));
      return {
        success: true,
        data: {
          count,
          exact: Boolean(result.exact),
          scope: "inbox",
          source: "provider_counter",
          asOf: new Date().toISOString(),
        },
        message: `You have ${count} unread emails right now.`,
        meta: asMetaItemCount(1),
      };
    } catch (error) {
      const fallback = await runUnifiedSearchThreads({
        query: "unread",
        unread: true,
        sort: "newest",
        limit: 100,
        fetchAll: false,
      }, "inbox");
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
          scope: "inbox",
          source: totalEstimate !== null ? "provider_estimate" : "sample_count",
          asOf: new Date().toISOString(),
        },
        message: `You have about ${count} unread emails right now.`,
        truncated: fallback.truncated,
        paging: paging ?? undefined,
        meta: asMetaItemCount(1),
      };
    }
  };

  const runBulkIds = async (
    filter: Record<string, unknown>,
  ): Promise<string[]> => {
    const search = await runUnifiedSearchThreads({
      ...filter,
      subscriptionsOnly: Boolean(filter.subscriptionsOnly),
      limit: typeof filter.limit === "number" ? filter.limit : 1000,
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
    async getUnreadCount(filter) {
      return runUnreadCount(filter);
    },

    async searchThreads(filter) {
      return runUnifiedSearchThreads(filter);
    },

    async searchThreadsAdvanced(filter) {
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

      const dateRange =
        filter.dateRange && typeof filter.dateRange === "object"
          ? (filter.dateRange as Record<string, unknown>)
          : undefined;

      const scanLimit =
        typeof input.scanLimit === "number" && Number.isFinite(input.scanLimit)
          ? Math.max(20, Math.min(800, Math.trunc(input.scanLimit)))
          : 250;

      const requestQuery =
        typeof filter.query === "string" && filter.query.trim().length > 0
          ? filter.query.trim()
          : undefined;
      const requestText =
        typeof filter.text === "string" && filter.text.trim().length > 0
          ? filter.text.trim()
          : undefined;
      const fallbackFacetQuery = capEnv.toolContext.currentMessage?.trim();
      const semanticQuery =
        requestQuery ??
        requestText ??
        (fallbackFacetQuery && fallbackFacetQuery.length > 0 ? fallbackFacetQuery : undefined);

      const search = await unifiedSearch.query({
        scopes: ["email"],
        query: semanticQuery,
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
        dateRange: dateRange
          ? {
              after:
                typeof dateRange.after === "string" ? dateRange.after : undefined,
              before:
                typeof dateRange.before === "string" ? dateRange.before : undefined,
              timeZone:
                typeof dateRange.timeZone === "string"
                  ? dateRange.timeZone
                  : typeof dateRange.timezone === "string"
                    ? dateRange.timezone
                    : undefined,
            }
          : undefined,
        sort: "newest",
        limit: scanLimit,
        fetchAll: false,
      });

      const messages = search.items
        .filter((item) => item.surface === "email")
        .map((item) => {
          const metadata =
            item.metadata && typeof item.metadata === "object"
              ? (item.metadata as Record<string, unknown>)
              : {};
          return {
            from: typeof metadata.from === "string" ? metadata.from : "",
            threadId:
              typeof metadata.threadId === "string"
                ? metadata.threadId
                : typeof metadata.sourceParentId === "string"
                  ? metadata.sourceParentId
                  : "",
          };
        });
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
        meta: asMetaItemCount(topSenders.length + topDomains.length),
      };
    },

    async searchSent(filter) {
      return runUnifiedSearchThreads({ ...filter, sentByMe: true }, "sent");
    },

    async searchInbox(filter) {
      return runUnifiedSearchThreads(filter, "inbox");
    },

    async getThreadMessages(threadId) {
      try {
        const thread = await getEmailThread(provider, threadId);
        const messages = Array.isArray(thread.messages) ? thread.messages : [];
        void recordEmailInteractionSignal({
          signalType: "result_open",
          threadId,
          messageIds: messages.map((message) => message.id).filter(Boolean),
          metadata: {
            action: "getThreadMessages",
          },
        });
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
        void recordEmailInteractionSignal({
          signalType: "result_open",
          messageIds: normalized,
          metadata: {
            action: "getMessagesBatch",
          },
        });
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
        if (latest?.id) {
          void recordEmailInteractionSignal({
            signalType: "result_open",
            threadId,
            messageIds: [latest.id],
            metadata: {
              action: "getLatestMessage",
            },
          });
        }
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
        void recordEmailInteractionSignal({
          signalType: "result_action",
          signalValue: 1.2,
          messageIds,
          metadata: {
            action: "batchArchive",
          },
        });
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
        void recordEmailInteractionSignal({
          signalType: "result_action",
          signalValue: 1.2,
          messageIds,
          metadata: {
            action: "batchTrash",
          },
        });
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
        void recordEmailInteractionSignal({
          signalType: "result_action",
          signalValue: read ? 0.8 : 0.4,
          messageIds,
          metadata: {
            action: "markReadUnread",
            read,
          },
        });
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
            ? (byId[0] as ParentMessage)
            : null;
      } catch {
        parentMessage = null;
      }

      if (!parentMessage) {
        try {
          const thread = await provider.getThread(parent);
          const messages = Array.isArray(thread.messages)
            ? (thread.messages as ParentMessage[])
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
            ? (byId[0] as ParentMessage)
            : null;
      } catch {
        parentMessage = null;
      }

      if (!parentMessage) {
        try {
          const thread = await provider.getThread(parent);
          const messages = Array.isArray(thread.messages)
            ? (thread.messages as ParentMessage[])
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
