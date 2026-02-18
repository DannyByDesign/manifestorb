import type { ToolResult } from "@/server/features/ai/tools/types";
import type { CapabilityEnvironment } from "@/server/features/ai/tools/runtime/capabilities/types";
import {
  createUnifiedSearchService,
} from "@/server/features/search/unified/service";
import type {
  UnifiedSearchMailbox,
  UnifiedSearchRequest,
  UnifiedSearchSurface,
} from "@/server/features/search/unified/types";

const SURFACES: UnifiedSearchSurface[] = ["email", "calendar", "rule", "memory"];
const MAILBOXES: UnifiedSearchMailbox[] = [
  "inbox",
  "sent",
  "draft",
  "trash",
  "spam",
  "archive",
  "all",
];

function asString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : undefined;
}

function asNumber(value: unknown): number | undefined {
  if (typeof value !== "number" || !Number.isFinite(value)) return undefined;
  return value;
}

function asBoolean(value: unknown): boolean | undefined {
  return typeof value === "boolean" ? value : undefined;
}

function asStringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string")
    : [];
}

function asTrimmedStringArray(value: unknown): string[] {
  return asStringArray(value)
    .map((item) => item.trim())
    .filter((item) => item.length > 0);
}

function toScopes(value: unknown): UnifiedSearchSurface[] | undefined {
  const values = asStringArray(value)
    .map((scope) => scope.trim().toLowerCase())
    .filter((scope): scope is UnifiedSearchSurface =>
      SURFACES.includes(scope as UnifiedSearchSurface),
    );
  return values.length > 0 ? values : undefined;
}

function toMailbox(value: unknown): UnifiedSearchMailbox | undefined {
  const normalized = asString(value)?.toLowerCase();
  if (!normalized) return undefined;
  return MAILBOXES.includes(normalized as UnifiedSearchMailbox)
    ? (normalized as UnifiedSearchMailbox)
    : undefined;
}

function toEmailCategory(value: unknown):
  | "primary"
  | "promotions"
  | "social"
  | "updates"
  | "forums"
  | undefined {
  const normalized = asString(value)?.toLowerCase();
  if (!normalized) return undefined;
  return normalized === "primary" ||
    normalized === "promotions" ||
    normalized === "social" ||
    normalized === "updates" ||
    normalized === "forums"
    ? normalized
    : undefined;
}

function toCalendarIds(input: Record<string, unknown>): string[] | undefined {
  const ids = Array.from(
    new Set([
      ...asTrimmedStringArray(input.calendarIds),
      ...(asString(input.calendarId) ? [asString(input.calendarId)!] : []),
    ]),
  ).filter(Boolean);
  return ids.length > 0 ? ids.slice(0, 50) : undefined;
}

function toRequest(input: Record<string, unknown>): UnifiedSearchRequest {
  const dateRangeRaw =
    input.dateRange && typeof input.dateRange === "object" && !Array.isArray(input.dateRange)
      ? (input.dateRange as Record<string, unknown>)
      : undefined;

  return {
    query: asString(input.query),
    text: asString(input.text),
    scopes: toScopes(input.scopes),
    mailbox: toMailbox(input.mailbox),
    sort:
      input.sort === "relevance" ||
      input.sort === "newest" ||
      input.sort === "oldest"
        ? input.sort
        : undefined,
    unread: asBoolean(input.unread),
    hasAttachment: asBoolean(input.hasAttachment),
    from: asString(input.from),
    to: asString(input.to),
    cc: asString(input.cc),
    fromEmails: (() => {
      const values = asTrimmedStringArray(input.fromEmails).slice(0, 50);
      return values.length > 0 ? values : undefined;
    })(),
    fromDomains: (() => {
      const values = asTrimmedStringArray(input.fromDomains).slice(0, 50);
      return values.length > 0 ? values : undefined;
    })(),
    toEmails: (() => {
      const values = asTrimmedStringArray(input.toEmails).slice(0, 50);
      return values.length > 0 ? values : undefined;
    })(),
    toDomains: (() => {
      const values = asTrimmedStringArray(input.toDomains).slice(0, 50);
      return values.length > 0 ? values : undefined;
    })(),
    ccEmails: (() => {
      const values = asTrimmedStringArray(input.ccEmails).slice(0, 50);
      return values.length > 0 ? values : undefined;
    })(),
    ccDomains: (() => {
      const values = asTrimmedStringArray(input.ccDomains).slice(0, 50);
      return values.length > 0 ? values : undefined;
    })(),
    category: toEmailCategory(input.category),
    attendeeEmail: asString(input.attendeeEmail) ?? asString(input.attendee),
    calendarIds: toCalendarIds(input),
    locationContains: asString(input.locationContains),
    attachmentMimeTypes: (() => {
      const values = asTrimmedStringArray(input.attachmentMimeTypes);
      return values.length > 0 ? values : undefined;
    })(),
    attachmentFilenameContains: asString(input.attachmentFilenameContains),
    dateRange:
      dateRangeRaw || asString(input.after) || asString(input.before)
        ? {
            after: asString(dateRangeRaw?.after) ?? asString(input.after),
            before: asString(dateRangeRaw?.before) ?? asString(input.before),
            timeZone: asString(dateRangeRaw?.timeZone) ?? asString(input.timeZone),
          }
        : undefined,
    limit: asNumber(input.limit),
    fetchAll: asBoolean(input.fetchAll),
  };
}

export interface SearchCapabilities {
  query(input: Record<string, unknown>): Promise<ToolResult>;
}

export function createSearchCapabilities(env: CapabilityEnvironment): SearchCapabilities {
  const service = createUnifiedSearchService({
    userId: env.runtime.userId,
    emailAccountId: env.runtime.emailAccountId,
    email: env.runtime.email,
    logger: env.runtime.logger,
    providers: env.toolContext.providers,
  });

  return {
    async query(input) {
      const request = toRequest(input);
      const hasQuery = Boolean(
        request.query ||
          request.text ||
          request.from ||
          request.to ||
          request.cc ||
          (request.fromEmails?.length ?? 0) > 0 ||
          (request.fromDomains?.length ?? 0) > 0 ||
          (request.toEmails?.length ?? 0) > 0 ||
          (request.toDomains?.length ?? 0) > 0 ||
          (request.ccEmails?.length ?? 0) > 0 ||
          (request.ccDomains?.length ?? 0) > 0 ||
          request.attendeeEmail ||
          request.locationContains,
      );
      const hasStructuredConstraints = Boolean(
        request.dateRange ||
          typeof request.unread === "boolean" ||
          typeof request.hasAttachment === "boolean" ||
          request.calendarIds?.length ||
          request.category ||
          (request.attachmentMimeTypes?.length ?? 0) > 0 ||
          request.attachmentFilenameContains,
      );
      const hasScopeOrMailbox = Boolean(request.scopes || request.mailbox);

      if (!hasQuery && !hasStructuredConstraints && !hasScopeOrMailbox) {
        return {
          success: false,
          error: "search_query_required",
          clarification: {
            kind: "missing_fields",
            prompt: "search_target_required",
            missingFields: ["query"],
          },
        };
      }

      // Clarification-first: mailbox/scopes alone is underspecified and should not return "recent items".
      if (!hasQuery && !hasStructuredConstraints && hasScopeOrMailbox) {
        return {
          success: false,
          error: "clarification_required",
          clarification: {
            kind: "missing_fields",
            prompt: "search_target_unclear",
            missingFields: ["query"],
          },
        };
      }

      try {
        const result = await service.query(request);
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
        return {
          success: true,
          data: result,
          message:
            result.items.length === 0
              ? "No matching results found across your connected surfaces."
              : `Found ${result.items.length} result${result.items.length === 1 ? "" : "s"} across ${Object.values(result.counts).filter((count) => count > 0).length} surface${Object.values(result.counts).filter((count) => count > 0).length === 1 ? "" : "s"}.`,
          truncated: result.truncated,
          meta: {
            resource: "knowledge",
            itemCount: result.items.length,
          },
        };
      } catch (error) {
        env.runtime.logger.error("Unified search capability failed", {
          userId: env.runtime.userId,
          emailAccountId: env.runtime.emailAccountId,
          error,
        });

        return {
          success: false,
          error: error instanceof Error ? error.message : "search_failed",
          message: "I couldn't complete unified search right now.",
          meta: {
            resource: "knowledge",
          },
        };
      }
    },
  };
}
