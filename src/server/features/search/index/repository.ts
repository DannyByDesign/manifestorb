import { randomUUID } from "crypto";
import prisma from "@/server/db/client";
import { Prisma } from "@/generated/prisma/client";
import { buildSearchChunks } from "@/server/features/search/index/chunking";
import type {
  SearchChunkInput,
  SearchDocumentIdentity,
  SearchIndexedDocument,
} from "@/server/features/search/index/types";

function toDateOrNull(value: string | undefined): Date | null {
  if (!value) return null;
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed)) return null;
  return new Date(parsed);
}

function toJsonSql(value: Record<string, unknown> | undefined): Prisma.Sql {
  if (!value) return Prisma.sql`NULL`;
  return Prisma.sql`${JSON.stringify(value)}::jsonb`;
}

async function replaceDocumentChunks(params: {
  documentId: string;
  userId: string;
  emailAccountId?: string;
  chunks: SearchChunkInput[];
}) {
  await prisma.$executeRaw`
    DELETE FROM "SearchChunk"
    WHERE "documentId" = ${params.documentId}
  `;

  for (const chunk of params.chunks) {
    await prisma.$executeRaw`
      INSERT INTO "SearchChunk" (
        "id",
        "createdAt",
        "updatedAt",
        "userId",
        "emailAccountId",
        "documentId",
        "ordinal",
        "content",
        "tokenCount",
        "metadata",
        "isDeleted"
      ) VALUES (
        ${randomUUID()},
        NOW(),
        NOW(),
        ${params.userId},
        ${params.emailAccountId ?? null},
        ${params.documentId},
        ${chunk.ordinal},
        ${chunk.content},
        ${chunk.tokenCount ?? null},
        ${JSON.stringify(chunk.metadata ?? {})}::jsonb,
        FALSE
      )
    `;
  }
}

export async function upsertIndexedDocument(params: {
  document: SearchIndexedDocument;
  chunks?: SearchChunkInput[];
}) {
  const document = params.document;
  const rows = await prisma.$queryRaw<{ id: string }[]>`
    INSERT INTO "SearchDocument" (
      "id",
      "createdAt",
      "updatedAt",
      "userId",
      "emailAccountId",
      "connector",
      "sourceType",
      "sourceId",
      "sourceParentId",
      "title",
      "snippet",
      "bodyText",
      "url",
      "authorIdentity",
      "occurredAt",
      "startAt",
      "endAt",
      "updatedSourceAt",
      "lastIngestedAt",
      "deletedAt",
      "isDeleted",
      "freshnessScore",
      "authorityScore",
      "metadata"
    ) VALUES (
      ${randomUUID()},
      NOW(),
      NOW(),
      ${document.userId},
      ${document.emailAccountId ?? null},
      ${document.connector},
      ${document.sourceType},
      ${document.sourceId},
      ${document.sourceParentId ?? null},
      ${document.title ?? null},
      ${document.snippet ?? null},
      ${document.bodyText ?? null},
      ${document.url ?? null},
      ${document.authorIdentity ?? null},
      ${toDateOrNull(document.occurredAt)},
      ${toDateOrNull(document.startAt)},
      ${toDateOrNull(document.endAt)},
      ${toDateOrNull(document.updatedSourceAt)},
      NOW(),
      ${document.isDeleted ? Prisma.sql`NOW()` : Prisma.sql`NULL`},
      ${document.isDeleted ?? false},
      ${document.freshnessScore ?? 0},
      ${document.authorityScore ?? 0},
      ${toJsonSql(document.metadata)}
    )
    ON CONFLICT ("userId", "connector", "sourceType", "sourceId")
    DO UPDATE SET
      "updatedAt" = NOW(),
      "emailAccountId" = EXCLUDED."emailAccountId",
      "sourceParentId" = EXCLUDED."sourceParentId",
      "title" = EXCLUDED."title",
      "snippet" = EXCLUDED."snippet",
      "bodyText" = EXCLUDED."bodyText",
      "url" = EXCLUDED."url",
      "authorIdentity" = EXCLUDED."authorIdentity",
      "occurredAt" = EXCLUDED."occurredAt",
      "startAt" = EXCLUDED."startAt",
      "endAt" = EXCLUDED."endAt",
      "updatedSourceAt" = EXCLUDED."updatedSourceAt",
      "lastIngestedAt" = NOW(),
      "deletedAt" = EXCLUDED."deletedAt",
      "isDeleted" = EXCLUDED."isDeleted",
      "freshnessScore" = EXCLUDED."freshnessScore",
      "authorityScore" = EXCLUDED."authorityScore",
      "metadata" = EXCLUDED."metadata"
    RETURNING "id"
  `;

  const documentId = rows[0]?.id;
  if (!documentId) return;

  const chunks = params.chunks ?? buildSearchChunks(document.bodyText);
  await replaceDocumentChunks({
    documentId,
    userId: document.userId,
    emailAccountId: document.emailAccountId,
    chunks,
  });
}

export async function markIndexedDocumentDeleted(identity: SearchDocumentIdentity) {
  await prisma.$executeRaw`
    UPDATE "SearchDocument"
    SET
      "updatedAt" = NOW(),
      "lastIngestedAt" = NOW(),
      "isDeleted" = TRUE,
      "deletedAt" = NOW()
    WHERE
      "userId" = ${identity.userId}
      AND "connector" = ${identity.connector}
      AND "sourceType" = ${identity.sourceType}
      AND "sourceId" = ${identity.sourceId}
  `;
}

export interface SearchIndexedDocumentRow {
  id: string;
  connector: string;
  sourceType: string;
  sourceId: string;
  sourceParentId: string | null;
  title: string | null;
  snippet: string | null;
  bodyText: string | null;
  url: string | null;
  authorIdentity: string | null;
  occurredAt: Date | null;
  startAt: Date | null;
  endAt: Date | null;
  updatedSourceAt: Date | null;
  freshnessScore: number | null;
  authorityScore: number | null;
  metadata: Record<string, unknown> | null;
}

export async function searchIndexedDocuments(params: {
  userId: string;
  emailAccountId?: string;
  query: string;
  connectors?: string[];
  limit: number;
}): Promise<SearchIndexedDocumentRow[]> {
  const query = params.query.trim();
  if (!query) return [];

  const connectors = (params.connectors ?? []).filter((value) => value.length > 0);
  const connectorFilter =
    connectors.length > 0
      ? Prisma.sql`AND d."connector" IN (${Prisma.join(connectors)})`
      : Prisma.empty;

  const pattern = `%${query}%`;

  try {
    return await prisma.$queryRaw<SearchIndexedDocumentRow[]>`
      SELECT
        d."id",
        d."connector",
        d."sourceType",
        d."sourceId",
        d."sourceParentId",
        d."title",
        d."snippet",
        d."bodyText",
        d."url",
        d."authorIdentity",
        d."occurredAt",
        d."startAt",
        d."endAt",
        d."updatedSourceAt",
        d."freshnessScore",
        d."authorityScore",
        d."metadata"
      FROM "SearchDocument" d
      WHERE
        d."userId" = ${params.userId}
        AND (d."emailAccountId" IS NULL OR d."emailAccountId" = ${params.emailAccountId ?? null})
        AND d."isDeleted" = FALSE
        ${connectorFilter}
        AND (
          to_tsvector('english', COALESCE(d."title", '') || ' ' || COALESCE(d."snippet", '') || ' ' || COALESCE(d."bodyText", ''))
            @@ plainto_tsquery('english', ${query})
          OR COALESCE(d."title", '') ILIKE ${pattern}
          OR COALESCE(d."snippet", '') ILIKE ${pattern}
          OR COALESCE(d."bodyText", '') ILIKE ${pattern}
        )
      ORDER BY
        ts_rank_cd(
          to_tsvector('english', COALESCE(d."title", '') || ' ' || COALESCE(d."snippet", '') || ' ' || COALESCE(d."bodyText", '')),
          plainto_tsquery('english', ${query})
        ) DESC,
        COALESCE(d."updatedSourceAt", d."occurredAt", d."updatedAt") DESC
      LIMIT ${Math.max(1, params.limit)}
    `;
  } catch (error) {
    const message = error instanceof Error ? error.message : "";
    if (message.includes(`relation "SearchDocument" does not exist`)) {
      return [];
    }
    throw error;
  }
}
