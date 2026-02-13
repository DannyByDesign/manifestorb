import type { ToolResult } from "@/server/features/ai/tools/types";
import type { CapabilityEnvironment } from "@/server/features/ai/capabilities/types";
import { env as appEnv } from "@/env";
import { Client } from "@upstash/qstash";
import { getInternalApiUrl } from "@/server/lib/internal-api";
import { getCronSecretHeader } from "@/server/lib/cron";
import type { ParsedMessage } from "@/server/types";

export interface EmailCapabilities {
  searchThreads(filter: Record<string, unknown>): Promise<ToolResult>;
  getThreadMessages(threadId: string): Promise<ToolResult>;
  batchArchive(ids: string[]): Promise<ToolResult>;
  unsubscribeSender(filterOrIds: { ids?: string[]; filter?: Record<string, unknown> }): Promise<ToolResult>;
  snoozeThread(ids: string[], snoozeUntil: string): Promise<ToolResult>;
  createDraft(input: {
    to?: string[];
    subject?: string;
    body: string;
    type?: "new" | "reply" | "forward";
    parentId?: string;
    sendOnApproval?: boolean;
  }): Promise<ToolResult>;
  scheduleSend(_draftId: string, _sendAt: string): Promise<ToolResult>;
}

function toDate(value: unknown): Date | undefined {
  if (typeof value !== "string") return undefined;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? undefined : parsed;
}

function normalizeText(value: string | undefined): string {
  return value?.trim().toLowerCase() ?? "";
}

function isLikelySubscription(message: ParsedMessage): boolean {
  const listUnsubscribe = message.headers?.["list-unsubscribe"] ?? "";
  const from = normalizeText(message.headers?.from ?? "");
  const haystack = normalizeText(
    [message.subject, message.snippet, message.textPlain, listUnsubscribe].filter(Boolean).join(" "),
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

function toSearchItems(messages: ParsedMessage[]): Array<Record<string, unknown>> {
  return messages.map((message) => ({
    id: message.id,
    threadId: message.threadId,
    title: message.subject || "(No Subject)",
    snippet: message.snippet || message.textPlain?.slice(0, 160) || "",
    date: message.date,
    from: message.headers?.from ?? "",
    to: message.headers?.to ?? "",
  }));
}

async function coerceToMessageIds(env: CapabilityEnvironment, ids: string[]): Promise<string[]> {
  const provider = env.toolContext.providers.email;
  const normalized = uniqueIds(ids);
  const out: string[] = [];

  for (const id of normalized) {
    try {
      const thread = await provider.getThread(id);
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

export function createEmailCapabilities(capEnv: CapabilityEnvironment): EmailCapabilities {
  const provider = capEnv.toolContext.providers.email;
  const runSearchThreads = async (filter: Record<string, unknown>): Promise<ToolResult> => {
    try {
      const dateRange =
        filter && typeof filter.dateRange === "object"
          ? (filter.dateRange as Record<string, unknown>)
          : undefined;
      const result = await provider.search({
        query: typeof filter.query === "string" ? filter.query : "",
        limit: typeof filter.limit === "number" ? filter.limit : 25,
        fetchAll: Boolean(filter.fetchAll),
        includeNonPrimary: Boolean(filter.subscriptionsOnly),
        before: toDate(dateRange?.before),
        after: toDate(dateRange?.after),
        subjectContains:
          typeof filter.subjectContains === "string" ? filter.subjectContains : undefined,
        bodyContains: typeof filter.bodyContains === "string" ? filter.bodyContains : undefined,
        text: typeof filter.text === "string" ? filter.text : undefined,
        from: typeof filter.from === "string" ? filter.from : undefined,
        to: typeof filter.to === "string" ? filter.to : undefined,
        hasAttachment:
          typeof filter.hasAttachment === "boolean" ? filter.hasAttachment : undefined,
        sentByMe: typeof filter.sentByMe === "boolean" ? filter.sentByMe : undefined,
        receivedByMe:
          typeof filter.receivedByMe === "boolean" ? filter.receivedByMe : undefined,
      });

      const messages = Boolean(filter.subscriptionsOnly)
        ? result.messages.filter(isLikelySubscription)
        : result.messages;
      const data = toSearchItems(messages);
      return {
        success: true,
        data,
        message:
          data.length === 0
            ? "No matching emails found."
            : `Found ${data.length} matching email${data.length === 1 ? "" : "s"}.`,
        truncated: Boolean(result.nextPageToken),
        paging: {
          nextPageToken: result.nextPageToken ?? null,
          totalEstimate: result.totalEstimate ?? null,
        },
        meta: {
          resource: "email",
          itemCount: data.length,
        },
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return {
        success: false,
        error: message,
        message: "I couldn't search your inbox right now.",
      };
    }
  };

  return {
    async searchThreads(filter) {
      return runSearchThreads(filter);
    },

    async getThreadMessages(threadId) {
      try {
        const thread = await provider.getThread(threadId);
        const messages = Array.isArray(thread.messages) ? thread.messages : [];
        return {
          success: true,
          data: { threadId, messages, snippet: thread.snippet },
          meta: { resource: "email", itemCount: messages.length },
          message: `Loaded ${messages.length} messages from the thread.`,
        };
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        return { success: false, error: message, message: "I couldn't load that thread right now." };
      }
    },

    async batchArchive(ids) {
      const messageIds = await coerceToMessageIds(capEnv, ids);
      if (messageIds.length === 0) {
        return {
          success: false,
          error: "No message ids provided.",
          clarification: {
            kind: "missing_fields",
            prompt: "I need at least one email or thread to archive.",
            missingFields: ["thread_ids"],
          },
        };
      }
      try {
        const result = await provider.modify(messageIds, { archive: true });
        return {
          success: result.success,
          data: { count: result.count },
          message: `Archived ${result.count} thread${result.count === 1 ? "" : "s"}.`,
          meta: { resource: "email", itemCount: result.count },
        };
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        return { success: false, error: message, message: "I couldn't archive those emails right now." };
      }
    },

    async unsubscribeSender(filterOrIds) {
      try {
        let targetIds: string[] = Array.isArray(filterOrIds.ids) ? filterOrIds.ids : [];
        if (targetIds.length === 0 && filterOrIds.filter) {
          const search = await runSearchThreads({
            ...filterOrIds.filter,
            subscriptionsOnly: true,
            limit: 100,
            fetchAll: true,
          });
          const items = Array.isArray(search.data) ? search.data : [];
          targetIds = items
            .map((item) =>
              item && typeof item === "object" ? (item as Record<string, unknown>).id : null,
            )
            .filter((id): id is string => typeof id === "string" && id.length > 0);
        }

        const messageIds = await coerceToMessageIds(capEnv, targetIds);
        if (messageIds.length === 0) {
          return {
            success: false,
            error: "No matching emails found to unsubscribe.",
            clarification: {
              kind: "missing_fields",
              prompt: "I couldn't find matching subscription emails. Which sender should I target?",
              missingFields: ["sender_or_domain"],
            },
          };
        }

        const result = await provider.modify(messageIds, { unsubscribe: true });
        return {
          success: result.success,
          data: { count: result.count },
          message:
            result.count > 0
              ? `Applied unsubscribe actions to ${result.count} email${result.count === 1 ? "" : "s"}.`
              : "No emails were updated for unsubscribe.",
          meta: { resource: "email", itemCount: result.count },
        };
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        return { success: false, error: message, message: "I couldn't apply unsubscribe controls right now." };
      }
    },

    async snoozeThread(ids, snoozeUntil) {
      if (!Array.isArray(ids) || ids.length === 0) {
        return {
          success: false,
          error: "No thread ids provided.",
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
          error: "Missing defer-until time.",
          clarification: {
            kind: "missing_fields",
            prompt: "What time should I defer these to?",
            missingFields: ["defer_until"],
          },
        };
      }
      try {
        const messageIds = await coerceToMessageIds(capEnv, ids);
        const result = await provider.modify(messageIds, { followUp: "enable" });
        return {
          success: result.success,
          data: { count: result.count, deferUntil: snoozeUntil },
          message: `Marked ${result.count} thread${result.count === 1 ? "" : "s"} for follow-up at ${snoozeUntil}.`,
          meta: { resource: "email", itemCount: result.count },
        };
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        return { success: false, error: message, message: "I couldn't defer those threads right now." };
      }
    },

    async createDraft(input) {
      try {
        const draftType: "new" | "reply" | "forward" =
          input.type ?? (input.parentId ? "reply" : "new");

        if (draftType === "new" && (!Array.isArray(input.to) || input.to.length === 0)) {
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
          ...(Array.isArray(input.to) && input.to.length > 0 ? { to: input.to } : {}),
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
          meta: { resource: "email", itemCount: 1 },
        };
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        return { success: false, error: message, message: "I couldn't create that draft right now." };
      }
    },

    async scheduleSend(_draftId, _sendAt) {
      const draftId = String(_draftId || "").trim();
      const sendAtRaw = String(_sendAt || "").trim();
      if (!draftId) return { success: false, error: "draft_id_missing", message: "Draft id is required." };

      const sendAt = new Date(sendAtRaw);
      if (Number.isNaN(sendAt.getTime())) {
        return { success: false, error: "invalid_send_time", message: "Send time must be an ISO-8601 timestamp." };
      }
      if (sendAt.getTime() < Date.now() + 30_000) {
        return { success: false, error: "send_time_in_past", message: "Send time must be at least 30 seconds in the future." };
      }

      if (!appEnv.QSTASH_TOKEN) {
        return {
          success: false,
          error: "qstash_not_configured",
          message: "Scheduled send requires QStash configuration in this environment.",
        };
      }

      const client = new Client({ token: appEnv.QSTASH_TOKEN });
      const url = `${getInternalApiUrl()}/api/drafts/schedule-send/execute`;
      const notBefore = Math.floor(sendAt.getTime() / 1000);
      const deduplicationId = `scheduled-draft-send:${capEnv.runtime.emailAccountId}:${draftId}:${notBefore}`;

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

        const scheduledId = "messageId" in response ? response.messageId : undefined;
        return {
          success: true,
          data: { scheduledId: scheduledId ?? null, sendAt: sendAt.toISOString() },
          message: scheduledId
            ? `Scheduled. It will send at ${sendAt.toISOString()}.`
            : `Scheduled. It will send at ${sendAt.toISOString()}.`,
        };
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        return { success: false, error: message, message: "I couldn't schedule that send right now." };
      }
    },
  };
}
