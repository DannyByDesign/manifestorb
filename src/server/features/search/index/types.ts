export type SearchConnector = "email" | "calendar" | "rule" | "memory";

export interface SearchDocumentIdentity {
  userId: string;
  connector: SearchConnector;
  sourceType: string;
  sourceId: string;
}

export interface SearchIndexedDocument extends SearchDocumentIdentity {
  emailAccountId?: string;
  sourceParentId?: string;
  title?: string;
  snippet?: string;
  bodyText?: string;
  url?: string;
  authorIdentity?: string;
  occurredAt?: string;
  startAt?: string;
  endAt?: string;
  updatedSourceAt?: string;
  isDeleted?: boolean;
  freshnessScore?: number;
  authorityScore?: number;
  metadata?: Record<string, unknown>;
}

export interface SearchChunkInput {
  ordinal: number;
  content: string;
  tokenCount?: number;
  metadata?: Record<string, unknown>;
}

export type SearchIndexJob =
  | {
      id: string;
      kind: "upsert_document";
      payload: SearchIndexedDocument;
      retries: number;
      createdAt: number;
      lastError?: string;
    }
  | {
      id: string;
      kind: "delete_document";
      payload: SearchDocumentIdentity;
      retries: number;
      createdAt: number;
      lastError?: string;
    };
