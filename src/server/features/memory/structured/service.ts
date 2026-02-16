import { randomUUID } from "crypto";
import prisma from "@/server/db/client";
import { createScopedLogger } from "@/server/lib/logger";

const logger = createScopedLogger("StructuredMemoryService");

function nowIso(): string {
  return new Date().toISOString();
}

function normalizePersonName(name: string): string {
  return name
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ")
    .slice(0, 160);
}

function parseOptionalDate(input?: string): Date | null {
  if (!input) return null;
  const date = new Date(input);
  if (Number.isNaN(date.getTime())) return null;
  return date;
}

export interface StructuredRelationshipInput {
  personName: string;
  relatedPersonName?: string;
  relationType: string;
  assertion: string;
  confidence: number;
  evidenceSnippet?: string;
  sourceMessageId?: string;
  episodeId?: string;
}

export interface StructuredCommitmentInput {
  description: string;
  owner: "user" | "other";
  counterpartName?: string;
  dueAt?: string;
  confidence: number;
  evidenceSnippet?: string;
  sourceMessageId?: string;
  episodeId?: string;
}

export interface StructuredEpisodeInput {
  title?: string;
  summary?: string;
  sourceConversationId?: string;
  sourceEmailThreadId?: string;
  sourceCalendarEventId?: string;
  startedAt?: Date;
  endedAt?: Date;
}

export async function ensurePersonMemory(userId: string, personName: string): Promise<string | null> {
  const displayName = personName.trim();
  if (!displayName) return null;

  const id = randomUUID();
  const normalizedName = normalizePersonName(displayName);

  try {
    const rows = await prisma.$queryRaw<Array<{ id: string }>>`
      INSERT INTO "PersonMemory" ("id", "userId", "displayName", "normalizedName", "createdAt", "updatedAt")
      VALUES (${id}, ${userId}, ${displayName}, ${normalizedName}, NOW(), NOW())
      ON CONFLICT ("userId", "normalizedName")
      DO UPDATE SET "displayName" = EXCLUDED."displayName", "updatedAt" = NOW()
      RETURNING "id"
    `;

    return rows[0]?.id ?? null;
  } catch (error) {
    logger.warn("Failed to ensure person memory row", {
      userId,
      personName: displayName,
      error: error instanceof Error ? error.message : String(error),
    });
    return null;
  }
}

export async function createInteractionEpisode(userId: string, input: StructuredEpisodeInput): Promise<string | null> {
  const id = randomUUID();

  try {
    const rows = await prisma.$queryRaw<Array<{ id: string }>>`
      INSERT INTO "InteractionEpisode" (
        "id", "userId", "title", "summary", "sourceConversationId", "sourceEmailThreadId",
        "sourceCalendarEventId", "startedAt", "endedAt", "createdAt", "updatedAt"
      )
      VALUES (
        ${id},
        ${userId},
        ${input.title ?? null},
        ${input.summary ?? null},
        ${input.sourceConversationId ?? null},
        ${input.sourceEmailThreadId ?? null},
        ${input.sourceCalendarEventId ?? null},
        ${input.startedAt ?? null},
        ${input.endedAt ?? null},
        NOW(),
        NOW()
      )
      RETURNING "id"
    `;

    return rows[0]?.id ?? null;
  } catch (error) {
    logger.warn("Failed to create interaction episode", {
      userId,
      error: error instanceof Error ? error.message : String(error),
    });
    return null;
  }
}

export async function attachEpisodeParticipant(params: {
  episodeId: string;
  personId: string;
  role?: string;
}): Promise<void> {
  const id = randomUUID();

  try {
    await prisma.$executeRaw`
      INSERT INTO "EpisodeParticipant" (
        "id", "episodeId", "personId", "role", "mentionCount", "createdAt"
      )
      VALUES (${id}, ${params.episodeId}, ${params.personId}, ${params.role ?? null}, 1, NOW())
      ON CONFLICT ("episodeId", "personId")
      DO UPDATE SET "mentionCount" = "EpisodeParticipant"."mentionCount" + 1
    `;
  } catch (error) {
    logger.warn("Failed to attach episode participant", {
      episodeId: params.episodeId,
      personId: params.personId,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

export async function recordRelationshipAssertion(params: {
  userId: string;
  input: StructuredRelationshipInput;
}): Promise<boolean> {
  const primaryPersonId = await ensurePersonMemory(params.userId, params.input.personName);
  if (!primaryPersonId) return false;

  const relatedPersonId = params.input.relatedPersonName
    ? await ensurePersonMemory(params.userId, params.input.relatedPersonName)
    : null;

  const assertionText = params.input.assertion.trim();
  if (!assertionText) return false;

  const assertionId = randomUUID();

  try {
    await prisma.$executeRaw`
      UPDATE "RelationshipAssertion"
      SET "status" = 'SUPERSEDED', "updatedAt" = NOW()
      WHERE "userId" = ${params.userId}
        AND "personId" = ${primaryPersonId}
        AND "relationType" = ${params.input.relationType}
        AND "status" = 'ACTIVE'
        AND "assertion" <> ${assertionText}
    `;

    await prisma.$executeRaw`
      INSERT INTO "RelationshipAssertion" (
        "id", "userId", "personId", "relatedPersonId", "relationType", "assertion", "status",
        "confidence", "evidenceSnippet", "sourceMessageId", "episodeId", "createdAt", "updatedAt"
      )
      VALUES (
        ${assertionId},
        ${params.userId},
        ${primaryPersonId},
        ${relatedPersonId},
        ${params.input.relationType},
        ${assertionText},
        'ACTIVE',
        ${Math.min(Math.max(params.input.confidence, 0), 1)},
        ${params.input.evidenceSnippet ?? null},
        ${params.input.sourceMessageId ?? null},
        ${params.input.episodeId ?? null},
        NOW(),
        NOW()
      )
    `;

    if (params.input.episodeId) {
      await attachEpisodeParticipant({
        episodeId: params.input.episodeId,
        personId: primaryPersonId,
        role: "subject",
      });
      if (relatedPersonId) {
        await attachEpisodeParticipant({
          episodeId: params.input.episodeId,
          personId: relatedPersonId,
          role: "related",
        });
      }
    }

    return true;
  } catch (error) {
    logger.warn("Failed to record relationship assertion", {
      userId: params.userId,
      relationType: params.input.relationType,
      error: error instanceof Error ? error.message : String(error),
    });
    return false;
  }
}

export async function recordCommitment(params: {
  userId: string;
  input: StructuredCommitmentInput;
}): Promise<boolean> {
  const description = params.input.description.trim();
  if (!description) return false;

  const personId = params.input.counterpartName
    ? await ensurePersonMemory(params.userId, params.input.counterpartName)
    : null;
  const dueAt = parseOptionalDate(params.input.dueAt);

  try {
    const existing = await prisma.$queryRaw<Array<{ id: string }>>`
      SELECT "id"
      FROM "CommitmentMemory"
      WHERE "userId" = ${params.userId}
        AND "status" = 'OPEN'
        AND LOWER("description") = LOWER(${description})
        AND (
          (${personId} IS NULL AND "personId" IS NULL)
          OR "personId" = ${personId}
        )
      ORDER BY "updatedAt" DESC
      LIMIT 1
    `;

    if (existing[0]?.id) {
      await prisma.$executeRaw`
        UPDATE "CommitmentMemory"
        SET "dueAt" = ${dueAt},
            "confidence" = ${Math.min(Math.max(params.input.confidence, 0), 1)},
            "evidenceSnippet" = ${params.input.evidenceSnippet ?? null},
            "sourceMessageId" = ${params.input.sourceMessageId ?? null},
            "episodeId" = ${params.input.episodeId ?? null},
            "updatedAt" = NOW()
        WHERE "id" = ${existing[0].id}
      `;
      return true;
    }

    const id = randomUUID();
    await prisma.$executeRaw`
      INSERT INTO "CommitmentMemory" (
        "id", "userId", "personId", "description", "owner", "status", "dueAt",
        "confidence", "evidenceSnippet", "sourceMessageId", "episodeId", "createdAt", "updatedAt"
      )
      VALUES (
        ${id},
        ${params.userId},
        ${personId},
        ${description},
        ${params.input.owner},
        'OPEN',
        ${dueAt},
        ${Math.min(Math.max(params.input.confidence, 0), 1)},
        ${params.input.evidenceSnippet ?? null},
        ${params.input.sourceMessageId ?? null},
        ${params.input.episodeId ?? null},
        NOW(),
        NOW()
      )
    `;

    if (params.input.episodeId && personId) {
      await attachEpisodeParticipant({
        episodeId: params.input.episodeId,
        personId,
        role: params.input.owner === "user" ? "counterpart" : "owner",
      });
    }

    return true;
  } catch (error) {
    logger.warn("Failed to record commitment", {
      userId: params.userId,
      description: description.slice(0, 80),
      error: error instanceof Error ? error.message : String(error),
    });
    return false;
  }
}

export async function recordMemoryEvidence(params: {
  userId: string;
  sourceMessageId?: string;
  excerpt: string;
}): Promise<void> {
  const excerpt = params.excerpt.trim();
  if (!excerpt) return;

  try {
    await prisma.$executeRaw`
      INSERT INTO "MemoryEvidence" (
        "id", "userId", "sourceMessageId", "excerpt", "evidenceHash", "createdAt"
      )
      VALUES (
        ${randomUUID()},
        ${params.userId},
        ${params.sourceMessageId ?? null},
        ${excerpt.slice(0, 600)},
        ${excerpt.slice(0, 120).toLowerCase()},
        NOW()
      )
    `;
  } catch (error) {
    logger.warn("Failed to record memory evidence", {
      userId: params.userId,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

export interface StructuredRecallResult {
  people: Array<{ id: string; displayName: string; relationshipCount: number }>;
  recentEpisodes: Array<{ id: string; summary: string | null; createdAt: string }>;
  commitments: Array<{ id: string; description: string; dueAt: string | null; status: string }>;
}

export async function retrieveStructuredMemory(params: {
  userId: string;
  query: string;
  limit?: number;
}): Promise<StructuredRecallResult> {
  const limit = Math.max(1, Math.min(20, params.limit ?? 8));
  const q = `%${params.query.toLowerCase()}%`;

  try {
    const [people, episodes, commitments] = await Promise.all([
      prisma.$queryRaw<Array<{ id: string; displayName: string; relationshipCount: bigint }>>`
        SELECT p."id", p."displayName", COUNT(r."id")::bigint AS "relationshipCount"
        FROM "PersonMemory" p
        LEFT JOIN "RelationshipAssertion" r
          ON r."personId" = p."id" AND r."status" = 'ACTIVE'
        WHERE p."userId" = ${params.userId}
          AND LOWER(p."displayName") LIKE ${q}
        GROUP BY p."id", p."displayName"
        ORDER BY COUNT(r."id") DESC, p."updatedAt" DESC
        LIMIT ${limit}
      `,
      prisma.$queryRaw<Array<{ id: string; summary: string | null; createdAt: Date }>>`
        SELECT "id", "summary", "createdAt"
        FROM "InteractionEpisode"
        WHERE "userId" = ${params.userId}
          AND (
            LOWER(COALESCE("summary", '')) LIKE ${q}
            OR LOWER(COALESCE("title", '')) LIKE ${q}
          )
        ORDER BY "createdAt" DESC
        LIMIT ${limit}
      `,
      prisma.$queryRaw<Array<{ id: string; description: string; dueAt: Date | null; status: string }>>`
        SELECT "id", "description", "dueAt", "status"
        FROM "CommitmentMemory"
        WHERE "userId" = ${params.userId}
          AND (
            LOWER("description") LIKE ${q}
            OR LOWER(COALESCE("status", '')) LIKE ${q}
          )
        ORDER BY "updatedAt" DESC
        LIMIT ${limit}
      `,
    ]);

    return {
      people: people.map((person) => ({
        id: person.id,
        displayName: person.displayName,
        relationshipCount: Number(person.relationshipCount ?? 0),
      })),
      recentEpisodes: episodes.map((episode) => ({
        id: episode.id,
        summary: episode.summary,
        createdAt: episode.createdAt.toISOString(),
      })),
      commitments: commitments.map((commitment) => ({
        id: commitment.id,
        description: commitment.description,
        dueAt: commitment.dueAt ? commitment.dueAt.toISOString() : null,
        status: commitment.status,
      })),
    };
  } catch (error) {
    logger.warn("Structured memory retrieval failed", {
      userId: params.userId,
      query: params.query,
      error: error instanceof Error ? error.message : String(error),
    });
    return {
      people: [],
      recentEpisodes: [],
      commitments: [],
    };
  }
}

export async function logMemoryAccessAudit(params: {
  userId: string;
  accessType: string;
  query?: string;
  resultCount?: number;
  surface?: string;
  metadata?: Record<string, unknown>;
}): Promise<void> {
  try {
    await prisma.$executeRaw`
      INSERT INTO "MemoryAccessAudit" (
        "id", "userId", "surface", "query", "accessType", "resultCount", "metadata", "createdAt"
      )
      VALUES (
        ${randomUUID()},
        ${params.userId},
        ${params.surface ?? null},
        ${params.query ?? null},
        ${params.accessType},
        ${params.resultCount ?? null},
        ${params.metadata ? JSON.stringify(params.metadata) : null}::jsonb,
        NOW()
      )
    `;
  } catch {
    // Audit logging is best-effort and should not fail user flows.
  }
}

export async function applyMemoryRetentionPolicies(params: {
  userId?: string;
}): Promise<{
  purgedFacts: number;
  purgedAudits: number;
  supersededRelationships: number;
}> {
  const runDeleteFacts = params.userId
    ? prisma.$executeRaw`
        DELETE FROM "MemoryFact"
        WHERE "isActive" = false
          AND "updatedAt" < NOW() - INTERVAL '180 days'
          AND "userId" = ${params.userId}
      `
    : prisma.$executeRaw`
        DELETE FROM "MemoryFact"
        WHERE "isActive" = false
          AND "updatedAt" < NOW() - INTERVAL '180 days'
      `;

  const runDeleteAudit = params.userId
    ? prisma.$executeRaw`
        DELETE FROM "MemoryAccessAudit"
        WHERE "createdAt" < NOW() - INTERVAL '90 days'
          AND "userId" = ${params.userId}
      `
    : prisma.$executeRaw`
        DELETE FROM "MemoryAccessAudit"
        WHERE "createdAt" < NOW() - INTERVAL '90 days'
      `;

  const runSupersedeRelationships = params.userId
    ? prisma.$executeRaw`
        UPDATE "RelationshipAssertion"
        SET "status" = 'SUPERSEDED', "updatedAt" = NOW()
        WHERE "status" = 'ACTIVE'
          AND "updatedAt" < NOW() - INTERVAL '365 days'
          AND "userId" = ${params.userId}
      `
    : prisma.$executeRaw`
        UPDATE "RelationshipAssertion"
        SET "status" = 'SUPERSEDED', "updatedAt" = NOW()
        WHERE "status" = 'ACTIVE'
          AND "updatedAt" < NOW() - INTERVAL '365 days'
      `;

  const [purgedFactsResult, purgedAuditsResult, supersededResult] = await Promise.all([
    runDeleteFacts,
    runDeleteAudit,
    runSupersedeRelationships,
  ]);

  return {
    purgedFacts: Number(purgedFactsResult),
    purgedAudits: Number(purgedAuditsResult),
    supersededRelationships: Number(supersededResult),
  };
}

export function safeIsoNow(): string {
  return nowIso();
}
