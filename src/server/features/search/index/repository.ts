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

function toJsonInput(
  value: Record<string, unknown> | undefined,
): Prisma.NullableJsonNullValueInput | Prisma.InputJsonValue | undefined {
  if (value === undefined) return undefined;
  return value as Prisma.InputJsonValue;
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

export interface SearchAliasExpansionRow {
  entityType: string;
  canonicalValue: string;
  aliasValue: string;
  confidence: number;
}

export interface SearchIngestionLagRow {
  connector: string;
  streamCount: number;
  lagMs: number | null;
  staleStreams: number;
  lastSyncedAt: Date | null;
}

export interface SearchFreshnessRow {
  connector: string;
  documentCount: number;
  staleDocumentCount: number;
  newestIngestedAt: Date | null;
  oldestIngestedAt: Date | null;
}

export interface SearchBehaviorScoreRow {
  documentId: string;
  score: number;
}

export async function lookupSearchDocumentIds(params: {
  userId: string;
  emailAccountId?: string;
  connector?: string;
  sourceIds?: string[];
  sourceParentIds?: string[];
  limit?: number;
}): Promise<string[]> {
  const sourceIds = Array.from(
    new Set(
      (params.sourceIds ?? [])
        .map((value) => value.trim())
        .filter((value) => value.length > 0),
    ),
  );
  const sourceParentIds = Array.from(
    new Set(
      (params.sourceParentIds ?? [])
        .map((value) => value.trim())
        .filter((value) => value.length > 0),
    ),
  );
  if (sourceIds.length === 0 && sourceParentIds.length === 0) return [];

  const rows = await prisma.searchDocument.findMany({
    where: {
      userId: params.userId,
      isDeleted: false,
      ...(params.emailAccountId
        ? {
            OR: [{ emailAccountId: params.emailAccountId }, { emailAccountId: null }],
          }
        : {}),
      ...(params.connector ? { connector: params.connector } : {}),
      AND: [
        {
          OR: [
            ...(sourceIds.length > 0
              ? [{ sourceId: { in: sourceIds } }]
              : []),
            ...(sourceParentIds.length > 0
              ? [{ sourceParentId: { in: sourceParentIds } }]
              : []),
          ],
        },
      ],
    },
    orderBy: [{ updatedSourceAt: "desc" }, { updatedAt: "desc" }],
    take: Math.max(1, Math.min(params.limit ?? 200, 1000)),
    select: { id: true },
  });

  return rows.map((row) => row.id);
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

export async function listRecentIndexedDocuments(params: {
  userId: string;
  emailAccountId?: string;
  connectors?: string[];
  limit: number;
}): Promise<SearchIndexedDocumentRow[]> {
  const connectors = (params.connectors ?? []).filter((value) => value.length > 0);
  const connectorFilter =
    connectors.length > 0
      ? Prisma.sql`AND d."connector" IN (${Prisma.join(connectors)})`
      : Prisma.empty;

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
      ORDER BY COALESCE(d."updatedSourceAt", d."occurredAt", d."updatedAt") DESC
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

export async function upsertSearchEntity(params: {
  userId: string;
  emailAccountId?: string;
  entityType: string;
  canonicalValue: string;
  displayValue?: string;
  confidence?: number;
  metadata?: Record<string, unknown>;
}) {
  const canonicalValue = params.canonicalValue.trim().toLowerCase();
  if (!canonicalValue) return;

  await prisma.searchEntity.upsert({
    where: {
      userId_entityType_canonicalValue: {
        userId: params.userId,
        entityType: params.entityType,
        canonicalValue,
      },
    },
    create: {
      userId: params.userId,
      emailAccountId: params.emailAccountId,
      entityType: params.entityType,
      canonicalValue,
      displayValue: params.displayValue ?? canonicalValue,
      confidence: params.confidence ?? 1,
      metadata: toJsonInput(params.metadata),
      isDeleted: false,
    },
    update: {
      updatedAt: new Date(),
      emailAccountId: params.emailAccountId ?? null,
      displayValue: params.displayValue ?? canonicalValue,
      confidence: params.confidence ?? 1,
      metadata: toJsonInput(params.metadata),
      isDeleted: false,
    },
  });
}

export async function upsertSearchAlias(params: {
  userId: string;
  emailAccountId?: string;
  entityType: string;
  canonicalValue: string;
  aliasValue: string;
  confidence?: number;
  metadata?: Record<string, unknown>;
}) {
  const canonicalValue = params.canonicalValue.trim().toLowerCase();
  const aliasValue = params.aliasValue.trim().toLowerCase();
  if (!canonicalValue || !aliasValue) return;

  await prisma.searchAlias.upsert({
    where: {
      userId_entityType_canonicalValue_aliasValue: {
        userId: params.userId,
        entityType: params.entityType,
        canonicalValue,
        aliasValue,
      },
    },
    create: {
      userId: params.userId,
      emailAccountId: params.emailAccountId,
      entityType: params.entityType,
      canonicalValue,
      aliasValue,
      confidence: params.confidence ?? 1,
      metadata: toJsonInput(params.metadata),
      isDeleted: false,
    },
    update: {
      updatedAt: new Date(),
      emailAccountId: params.emailAccountId ?? null,
      confidence: params.confidence ?? 1,
      metadata: toJsonInput(params.metadata),
      isDeleted: false,
    },
  });
}

export async function lookupSearchAliasExpansions(params: {
  userId: string;
  emailAccountId?: string;
  terms: string[];
  limit?: number;
}): Promise<SearchAliasExpansionRow[]> {
  const normalizedTerms = Array.from(
    new Set(
      params.terms
        .map((term) => term.trim().toLowerCase())
        .filter((term) => term.length > 1),
    ),
  );
  if (normalizedTerms.length === 0) return [];

  const termFilters = normalizedTerms.flatMap((term) => [
    { aliasValue: { equals: term, mode: "insensitive" as const } },
    { canonicalValue: { equals: term, mode: "insensitive" as const } },
    { aliasValue: { contains: term, mode: "insensitive" as const } },
    { canonicalValue: { contains: term, mode: "insensitive" as const } },
  ]);

  const rows = await prisma.searchAlias.findMany({
    where: {
      userId: params.userId,
      isDeleted: false,
      ...(params.emailAccountId
        ? {
            OR: [{ emailAccountId: params.emailAccountId }, { emailAccountId: null }],
          }
        : {}),
      AND: [{ OR: termFilters }],
    },
    orderBy: [{ confidence: "desc" }, { updatedAt: "desc" }],
    take: Math.max(5, Math.min(params.limit ?? 60, 200)),
    select: {
      entityType: true,
      canonicalValue: true,
      aliasValue: true,
      confidence: true,
    },
  });

  return rows.map((row) => ({
    entityType: row.entityType,
    canonicalValue: row.canonicalValue,
    aliasValue: row.aliasValue,
    confidence: row.confidence,
  }));
}

export async function recordSearchSignals(params: {
  userId: string;
  emailAccountId?: string;
  signalType: string;
  signalValue: number;
  documentIds: string[];
  metadata?: Record<string, unknown>;
}) {
  const documentIds = Array.from(
    new Set(params.documentIds.map((id) => id.trim()).filter((id) => id.length > 0)),
  );
  if (documentIds.length === 0) return;

  await prisma.searchSignal.createMany({
    data: documentIds.map((documentId) => ({
      userId: params.userId,
      emailAccountId: params.emailAccountId ?? null,
      documentId,
      signalType: params.signalType,
      signalValue: params.signalValue,
      metadata: toJsonInput(params.metadata),
    })),
  });
}

export async function upsertSearchIngestionCheckpoint(params: {
  userId: string;
  emailAccountId?: string;
  connector: string;
  streamKey: string;
  cursor?: string | null;
  cursorNumeric?: bigint | number | null;
  state?: Record<string, unknown>;
  status?: string;
  errorMessage?: string | null;
  lastSyncedAt?: Date;
}) {
  const cursorNumeric =
    typeof params.cursorNumeric === "bigint"
      ? params.cursorNumeric
      : typeof params.cursorNumeric === "number" && Number.isFinite(params.cursorNumeric)
        ? BigInt(Math.trunc(params.cursorNumeric))
        : null;

  await prisma.searchIngestionCheckpoint.upsert({
    where: {
      userId_connector_streamKey: {
        userId: params.userId,
        connector: params.connector,
        streamKey: params.streamKey,
      },
    },
    create: {
      userId: params.userId,
      emailAccountId: params.emailAccountId,
      connector: params.connector,
      streamKey: params.streamKey,
      cursor: params.cursor ?? null,
      cursorNumeric,
      state: toJsonInput(params.state),
      status: params.status ?? "active",
      errorMessage: params.errorMessage ?? null,
      lastSyncedAt: params.lastSyncedAt ?? new Date(),
    },
    update: {
      updatedAt: new Date(),
      emailAccountId: params.emailAccountId ?? null,
      cursor: params.cursor ?? null,
      cursorNumeric,
      state: toJsonInput(params.state),
      status: params.status ?? "active",
      errorMessage: params.errorMessage ?? null,
      lastSyncedAt: params.lastSyncedAt ?? new Date(),
    },
  });
}

export async function markSearchIngestionCheckpointError(params: {
  userId: string;
  connector: string;
  streamKey: string;
  errorMessage: string;
}) {
  await prisma.searchIngestionCheckpoint.updateMany({
    where: {
      userId: params.userId,
      connector: params.connector,
      streamKey: params.streamKey,
    },
    data: {
      updatedAt: new Date(),
      status: "error",
      errorMessage: params.errorMessage.slice(0, 500),
    },
  });
}

export async function listSearchIngestionLag(params: {
  userId?: string;
} = {}): Promise<SearchIngestionLagRow[]> {
  const userFilter = params.userId
    ? Prisma.sql`WHERE "userId" = ${params.userId}`
    : Prisma.empty;

  try {
    return await prisma.$queryRaw<SearchIngestionLagRow[]>`
      SELECT
        c."connector"::text AS "connector",
        COUNT(*)::int AS "streamCount",
        MAX(c."lastSyncedAt") AS "lastSyncedAt",
        CASE
          WHEN MAX(c."lastSyncedAt") IS NULL THEN NULL
          ELSE (EXTRACT(EPOCH FROM (NOW() - MAX(c."lastSyncedAt"))) * 1000)::bigint
        END AS "lagMs",
        COUNT(*) FILTER (
          WHERE c."status" <> 'active'
             OR c."lastSyncedAt" IS NULL
             OR c."lastSyncedAt" < NOW() - INTERVAL '15 minutes'
        )::int AS "staleStreams"
      FROM "SearchIngestionCheckpoint" c
      ${userFilter}
      GROUP BY c."connector"
      ORDER BY c."connector" ASC
    `;
  } catch (error) {
    const message = error instanceof Error ? error.message : "";
    if (message.includes(`relation "SearchIngestionCheckpoint" does not exist`)) {
      return [];
    }
    throw error;
  }
}

export async function listSearchFreshnessByConnector(params: {
  userId?: string;
} = {}): Promise<SearchFreshnessRow[]> {
  const userFilter = params.userId
    ? Prisma.sql`WHERE d."userId" = ${params.userId}`
    : Prisma.empty;

  try {
    return await prisma.$queryRaw<SearchFreshnessRow[]>`
      SELECT
        d."connector"::text AS "connector",
        COUNT(*)::int AS "documentCount",
        COUNT(*) FILTER (
          WHERE d."lastIngestedAt" < NOW() - INTERVAL '6 hours'
             OR d."lastIngestedAt" IS NULL
        )::int AS "staleDocumentCount",
        MAX(d."lastIngestedAt") AS "newestIngestedAt",
        MIN(d."lastIngestedAt") AS "oldestIngestedAt"
      FROM "SearchDocument" d
      ${userFilter}
      GROUP BY d."connector"
      ORDER BY d."connector" ASC
    `;
  } catch (error) {
    const message = error instanceof Error ? error.message : "";
    if (message.includes(`relation "SearchDocument" does not exist`)) {
      return [];
    }
    throw error;
  }
}

export async function getSearchBehaviorScores(params: {
  userId: string;
  emailAccountId?: string;
  documentIds: string[];
  days?: number;
}): Promise<SearchBehaviorScoreRow[]> {
  const documentIds = Array.from(
    new Set(params.documentIds.map((id) => id.trim()).filter((id) => id.length > 0)),
  );
  if (documentIds.length === 0) return [];

  const days = Math.max(1, Math.min(params.days ?? 30, 180));

  try {
    return await prisma.$queryRaw<SearchBehaviorScoreRow[]>`
      SELECT
        s."documentId"::text AS "documentId",
        LEAST(
          1,
          SUM(
            (
              CASE
                WHEN s."signalType" = 'result_action' THEN s."signalValue" * 1.35
                WHEN s."signalType" = 'result_open' THEN s."signalValue" * 1.1
                WHEN s."signalType" = 'result_impression' THEN s."signalValue" * 0.2
                WHEN s."signalType" = 'query_hit' THEN s."signalValue" * 0.15
                WHEN s."signalType" = 'dismiss' THEN s."signalValue" * -0.6
                ELSE s."signalValue"
              END
            ) * EXP(
              -EXTRACT(EPOCH FROM (NOW() - s."occurredAt")) / ${(days * 24 * 60 * 60)}
            )
          )
        )::float AS "score"
      FROM "SearchSignal" s
      WHERE
        s."userId" = ${params.userId}
        AND (s."emailAccountId" IS NULL OR s."emailAccountId" = ${params.emailAccountId ?? null})
        AND s."documentId" IN (${Prisma.join(documentIds)})
        AND s."occurredAt" >= NOW() - (${days} * INTERVAL '1 day')
      GROUP BY s."documentId"
      ORDER BY "score" DESC
    `;
  } catch (error) {
    const message = error instanceof Error ? error.message : "";
    if (message.includes(`relation "SearchSignal" does not exist`)) {
      return [];
    }
    throw error;
  }
}
