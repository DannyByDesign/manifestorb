import type { EmailProvider } from "@/server/features/ai/tools/providers/email";
import type { CalendarProvider } from "@/server/features/ai/tools/providers/calendar";
import type { Logger } from "@/server/lib/logger";

export type UnifiedSearchSurface = "email" | "calendar" | "rule" | "memory";

export type UnifiedSearchMailbox =
  | "inbox"
  | "sent"
  | "draft"
  | "trash"
  | "spam"
  | "archive"
  | "all";

export interface UnifiedSearchDateRange {
  after?: string;
  before?: string;
  timeZone?: string;
}

export interface UnifiedSearchRequest {
  query?: string;
  text?: string;
  scopes?: UnifiedSearchSurface[];
  mailbox?: UnifiedSearchMailbox;
  from?: string;
  to?: string;
  attendeeEmail?: string;
  dateRange?: UnifiedSearchDateRange;
  limit?: number;
  fetchAll?: boolean;
}

export interface UnifiedSearchRankingFeatures {
  lexical: number;
  semantic?: number;
  freshness: number;
  authority: number;
  intentSurface: number;
  behavior: number;
  graphProximity: number;
  final: number;
}

export interface UnifiedSearchItem {
  surface: UnifiedSearchSurface;
  id: string;
  title: string;
  snippet: string;
  timestamp?: string;
  score: number;
  lexicalScore?: number;
  semanticScore?: number;
  ranking?: UnifiedSearchRankingFeatures;
  metadata?: Record<string, unknown>;
}

export interface UnifiedSearchResult {
  items: UnifiedSearchItem[];
  counts: Record<UnifiedSearchSurface, number>;
  total: number;
  truncated: boolean;
  queryPlan?: {
    query: string;
    rewrittenQuery: string;
    queryVariants: string[];
    scopes: UnifiedSearchSurface[];
    mailbox?: UnifiedSearchMailbox;
    aliasExpansions: string[];
  };
}

export interface UnifiedSearchEnvironment {
  userId: string;
  emailAccountId: string;
  email: string;
  logger: Logger;
  providers: {
    email: EmailProvider;
    calendar: CalendarProvider;
  };
}

export interface RankingDocument {
  id: string;
  surface: UnifiedSearchSurface;
  title: string;
  snippet: string;
  timestamp?: string;
  metadata?: Record<string, unknown>;
}

export interface UnifiedSearchIntentHints {
  requestedSurfaces: Set<UnifiedSearchSurface>;
  mailbox?: UnifiedSearchMailbox;
}
