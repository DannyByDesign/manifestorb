import type { ToolResult } from "@/server/features/ai/tools/types";
import type { CapabilityEnvironment } from "@/server/features/ai/tools/runtime/capabilities/types";
import { env as appEnv } from "@/env";
import { Client } from "@upstash/qstash";
import { getInternalApiUrl } from "@/server/lib/internal-api";
import { getCronSecretHeader } from "@/server/lib/cron";
import type { ParsedMessage } from "@/server/types";
import {
  resolveCalendarTimeZoneForRequest,
  resolveDefaultCalendarTimeZone,
} from "@/server/features/ai/tools/calendar-time";
import { parseDateBoundInTimeZone } from "@/server/features/ai/tools/timezone";
import {
  capabilityFailureResult,
  classifyCapabilityError,
} from "@/server/features/ai/tools/runtime/capabilities/errors";
import { createCapabilityIdempotencyKey } from "@/server/features/ai/tools/runtime/capabilities/idempotency";
import {
  getEmailMessages,
  getEmailThread,
  modifyEmailMessages,
  searchEmailThreads,
  trashEmailMessages,
} from "@/server/features/ai/tools/email/primitives";
import { formatDateTimeForUser } from "@/server/features/ai/tools/timezone";

export interface EmailCapabilities {
  searchThreads(filter: Record<string, unknown>): Promise<ToolResult>;
  searchThreadsAdvanced(filter: Record<string, unknown>): Promise<ToolResult>;
  searchSent(filter: Record<string, unknown>): Promise<ToolResult>;
  searchInbox(filter: Record<string, unknown>): Promise<ToolResult>;
  getThreadMessages(threadId: string): Promise<ToolResult>;
  getMessagesBatch(ids: string[]): Promise<ToolResult>;
  getLatestMessage(threadId: string): Promise<ToolResult>;
  batchArchive(ids: string[]): Promise<ToolResult>;
  batchTrash(ids: string[]): Promise<ToolResult>;
  markReadUnread(ids: string[], read: boolean): Promise<ToolResult>;
  applyLabels(ids: string[], labelIds: string[]): Promise<ToolResult>;
  removeLabels(ids: string[], labelIds: string[]): Promise<ToolResult>;
  moveThread(ids: string[], folderName: string): Promise<ToolResult>;
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
  }): Promise<ToolResult>;
  forward(input: {
    parentId: string;
    to: string[];
    body?: string;
    subject?: string;
  }): Promise<ToolResult>;
  scheduleSend(_draftId: string, _sendAt: string): Promise<ToolResult>;
}

function normalizeText(value: string | undefined): string {
  return value?.trim().toLowerCase() ?? "";
}

function isLikelySubscription(message: ParsedMessage): boolean {
  const listUnsubscribe = message.headers?.["list-unsubscribe"] ?? "";
  const from = normalizeText(message.headers?.from ?? "");
  const haystack = normalizeText(
    [message.subject, message.snippet, message.textPlain, listUnsubscribe]
      .filter(Boolean)
      .join(" "),
  );
  return (
    listUnsubscribe.trim().length > 0 ||
    haystack.includes("unsubscribe") ||
    haystack.includes("manage preferences") ||
    from.includes("noreply") ||
    from.includes("newsletter") ||
    from.includes("updates")
  );
}

function uniqueIds(ids: string[]): string[] {
  return Array.from(new Set(ids.map((id) => id.trim()).filter(Boolean)));
}

function toSearchItems(
  messages: ParsedMessage[],
  options?: { timeZone?: string },
): Array<Record<string, unknown>> {
  return messages.map((message) => {
    const timestampMs = messageTimestampMs(message);
    const normalizedDate =
      timestampMs > 0
        ? new Date(timestampMs).toISOString()
        : message.date ?? null;
    const dateLocal =
      options?.timeZone && timestampMs > 0
        ? formatDateTimeForUser(new Date(timestampMs), options.timeZone)
        : null;

    return {
      id: message.id,
      threadId: message.threadId,
      title: message.subject || "(No Subject)",
      snippet: message.snippet || message.textPlain?.slice(0, 160) || "",
      date: normalizedDate,
      dateLocal,
      from: message.headers?.from ?? "",
      to: message.headers?.to ?? "",
    };
  });
}

function messageTimestampMs(message: ParsedMessage): number {
  if (typeof message.internalDate === "string" && message.internalDate.trim().length > 0) {
    const asInt = Number.parseInt(message.internalDate, 10);
    if (Number.isFinite(asInt) && asInt > 0) return asInt;
  }
  if (typeof message.date === "string" && message.date.trim().length > 0) {
    const parsed = Date.parse(message.date);
    if (Number.isFinite(parsed) && parsed > 0) return parsed;
  }
  return 0;
}

function asMetaItemCount(count: number): ToolResult["meta"] {
  return { resource: "email", itemCount: count };
}

function clampInt(value: number, min: number, max: number): number {
  return Math.min(Math.max(Math.trunc(value), min), max);
}

function computeEmailSearchLimit(params: {
  requestedLimit?: number;
  fetchAll: boolean;
  hasDateRange: boolean;
  query: string;
}): number {
  const isAttentionQuery = /\bis:unread\b/i.test(params.query);

  if (params.fetchAll) {
    const defaultLimit = params.hasDateRange ? 1000 : 400;
    const maxLimit = params.hasDateRange ? 2000 : 1000;
    return clampInt(params.requestedLimit ?? defaultLimit, 1, maxLimit);
  }

  if (params.hasDateRange) {
    const defaultLimit = isAttentionQuery ? 100 : 60;
    return clampInt(params.requestedLimit ?? defaultLimit, 1, 200);
  }

  const defaultLimit = isAttentionQuery ? 60 : 20;
  return clampInt(params.requestedLimit ?? defaultLimit, 1, 100);
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

  const resolveEffectiveTimeZone = async (
    requestedTimeZone?: string,
  ): Promise<{ timeZone: string } | { error: string }> => {
    const defaultTimeZone = await getDefaultTimeZone();
    if ("error" in defaultTimeZone) return defaultTimeZone;
    const resolved = resolveCalendarTimeZoneForRequest({
      requestedTimeZone,
      defaultTimeZone: defaultTimeZone.timeZone,
    });
    if ("error" in resolved) return { error: resolved.error };
    return resolved;
  };

  const runSearchThreads = async (
    filter: Record<string, unknown>,
  ): Promise<ToolResult> => {
    try {
      const dateRange =
        filter && typeof filter.dateRange === "object"
          ? (filter.dateRange as Record<string, unknown>)
          : undefined;
      const requestedTimeZone =
        (typeof filter.timeZone === "string" ? filter.timeZone : undefined) ??
        (typeof filter.timezone === "string" ? filter.timezone : undefined) ??
        (typeof dateRange?.timeZone === "string" ? dateRange.timeZone : undefined) ??
        (typeof dateRange?.timezone === "string" ? dateRange.timezone : undefined);

      const resolvedTimeZone = await resolveEffectiveTimeZone(requestedTimeZone);
      if ("error" in resolvedTimeZone) {
        return {
          success: false,
          error: "invalid_time_zone",
          message: resolvedTimeZone.error,
          clarification: {
            kind: "invalid_fields",
            prompt: "Please provide a valid IANA timezone, like America/Los_Angeles.",
            missingFields: ["timeZone"],
          },
        };
      }
      const displayTimeZone = resolvedTimeZone.timeZone;

      let before: Date | undefined;
      let after: Date | undefined;
      if (typeof dateRange?.before === "string") {
        before = parseDateBoundInTimeZone(
          dateRange.before,
          displayTimeZone,
          "end",
        ) ?? undefined;
        if (!before) {
          return {
            success: false,
            error: "invalid_date_range_before",
            message:
              "Invalid dateRange.before. Use ISO-8601 or local date/datetime.",
            clarification: {
              kind: "invalid_fields",
              prompt: "I need a valid end date for that email search.",
              missingFields: ["dateRange.before"],
            },
          };
        }
      }

      if (typeof dateRange?.after === "string") {
        after = parseDateBoundInTimeZone(
          dateRange.after,
          displayTimeZone,
          "start",
        ) ?? undefined;
        if (!after) {
          return {
            success: false,
            error: "invalid_date_range_after",
            message:
              "Invalid dateRange.after. Use ISO-8601 or local date/datetime.",
            clarification: {
              kind: "invalid_fields",
              prompt: "I need a valid start date for that email search.",
              missingFields: ["dateRange.after"],
            },
          };
        }
      }

      const requestedLimit =
        typeof filter.limit === "number" && Number.isFinite(filter.limit)
          ? Math.floor(filter.limit)
          : undefined;
      const fetchAll = Boolean(filter.fetchAll);
      const hasDateRange = Boolean(before || after);
      const query = typeof filter.query === "string" ? filter.query : "";
      const normalizedLimit = computeEmailSearchLimit({
        requestedLimit,
        fetchAll,
        hasDateRange,
        query,
      });

      const result = await searchEmailThreads(provider, {
        query,
        limit: normalizedLimit,
        fetchAll,
        includeNonPrimary: Boolean(filter.subscriptionsOnly),
        before,
        after,
        subjectContains:
          typeof filter.subjectContains === "string"
            ? filter.subjectContains
            : undefined,
        bodyContains:
          typeof filter.bodyContains === "string" ? filter.bodyContains : undefined,
        text: typeof filter.text === "string" ? filter.text : undefined,
        from: typeof filter.from === "string" ? filter.from : undefined,
        to: typeof filter.to === "string" ? filter.to : undefined,
        hasAttachment:
          typeof filter.hasAttachment === "boolean"
            ? filter.hasAttachment
            : undefined,
        sentByMe:
          typeof filter.sentByMe === "boolean" ? filter.sentByMe : undefined,
        receivedByMe:
          typeof filter.receivedByMe === "boolean"
            ? filter.receivedByMe
            : undefined,
      });

      const messages = Boolean(filter.subscriptionsOnly)
        ? result.messages.filter(isLikelySubscription)
        : result.messages;
      const sortedMessages = [...messages].sort(
        (a, b) => messageTimestampMs(b) - messageTimestampMs(a),
      );
      const data = toSearchItems(sortedMessages, { timeZone: displayTimeZone });
      return {
        success: true,
        data,
        message:
          data.length === 0
            ? "No matching emails found."
            : result.nextPageToken
              ? `Found at least ${data.length} matching email${data.length === 1 ? "" : "s"}.`
              : `Found ${data.length} matching email${data.length === 1 ? "" : "s"}.`,
        truncated: Boolean(result.nextPageToken),
        paging: {
          nextPageToken: result.nextPageToken ?? null,
          totalEstimate: result.totalEstimate ?? null,
        },
        meta: asMetaItemCount(data.length),
      };
    } catch (error) {
      return capabilityFailureResult(error, "I couldn't search your inbox right now.", {
        resource: "email",
      });
    }
  };

  const runBulkIds = async (
    filter: Record<string, unknown>,
  ): Promise<string[]> => {
    const search = await runSearchThreads({
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

  return {
    async searchThreads(filter) {
      return runSearchThreads(filter);
    },

    async searchThreadsAdvanced(filter) {
      return runSearchThreads(filter);
    },

    async searchSent(filter) {
      return runSearchThreads({ ...filter, sentByMe: true });
    },

    async searchInbox(filter) {
      return runSearchThreads(filter);
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
            prompt: "Which email should I inspect?",
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

    async batchArchive(ids) {
      const messageIds = await coerceToMessageIds(capEnv, ids);
      if (messageIds.length === 0) {
        return {
          success: false,
          error: "invalid_input:no message ids",
          clarification: {
            kind: "missing_fields",
            prompt: "I need at least one email or thread to archive.",
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

    async batchTrash(ids) {
      const messageIds = await coerceToMessageIds(capEnv, ids);
      if (messageIds.length === 0) {
        return {
          success: false,
          error: "invalid_input:no message ids",
          clarification: {
            kind: "missing_fields",
            prompt: "I need at least one email or thread to trash.",
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

    async markReadUnread(ids, read) {
      const messageIds = await coerceToMessageIds(capEnv, ids);
      if (messageIds.length === 0) {
        return {
          success: false,
          error: "invalid_input:no message ids",
          clarification: {
            kind: "missing_fields",
            prompt: "I need at least one email or thread for read/unread changes.",
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

    async applyLabels(ids, labelIds) {
      const messageIds = await coerceToMessageIds(capEnv, ids);
      const normalizedLabels = uniqueIds(labelIds);
      if (messageIds.length === 0 || normalizedLabels.length === 0) {
        return {
          success: false,
          error: "invalid_input:missing ids or labels",
          clarification: {
            kind: "missing_fields",
            prompt: "I need target emails and at least one label.",
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

    async removeLabels(ids, labelIds) {
      const messageIds = await coerceToMessageIds(capEnv, ids);
      const normalizedLabels = uniqueIds(labelIds);
      if (messageIds.length === 0 || normalizedLabels.length === 0) {
        return {
          success: false,
          error: "invalid_input:missing ids or labels",
          clarification: {
            kind: "missing_fields",
            prompt: "I need target emails and labels to remove.",
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

    async moveThread(ids, folderName) {
      const threadIds = await coerceToThreadIds(capEnv, ids);
      if (threadIds.length === 0 || !folderName.trim()) {
        return {
          success: false,
          error: "invalid_input:missing thread or folder",
          clarification: {
            kind: "missing_fields",
            prompt: "I need target emails and a destination folder.",
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
            prompt: "I need at least one email thread to mark as spam.",
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
              prompt:
                "I couldn't find matching subscription emails. Which sender should I target?",
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
            prompt: "I need at least one sender email thread to block.",
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
            prompt: "I need the target thread(s) to defer.",
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
            prompt: "What time should I defer these to?",
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
            prompt: "Which sender/domain should this filter target?",
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
            prompt: "Which filter should I delete?",
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
            prompt: "Which draft should I inspect?",
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
              prompt: "Who should this email be sent to?",
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
            prompt: "Which draft should I update?",
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
            prompt: "What should I change in this draft?",
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
            prompt: "Which draft should I delete?",
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
            prompt: "Which draft should I send?",
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
            prompt: "I need recipients and a message body to send now.",
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
      try {
        const draft = await provider.createDraft({
          type: "reply",
          parentId: input.parentId,
          subject: input.subject,
          body: input.body,
        });
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
      try {
        const draft = await provider.createDraft({
          type: "forward",
          parentId: input.parentId,
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
            prompt: "Please set a valid integration timezone before scheduling send.",
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

      if (!appEnv.QSTASH_TOKEN) {
        return {
          success: false,
          error: "unsupported:qstash_not_configured",
          message:
            "Scheduled send requires QStash configuration in this environment.",
        };
      }

      const client = new Client({ token: appEnv.QSTASH_TOKEN });
      const url = `${getInternalApiUrl()}/api/drafts/schedule-send/execute`;
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

        const scheduledId =
          response && typeof response === "object" && "messageId" in response
            ? (response.messageId as string | undefined)
            : undefined;

        return {
          success: true,
          data: {
            scheduledId: scheduledId ?? null,
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
