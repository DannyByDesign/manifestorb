/**
 * Memory Recording Worker bridge
 *
 * Worker runtime delegates recording execution to the canonical core API job
 * implementation so extraction logic is defined in one place.
 */
import { prisma } from "../db/prisma";
import { env } from "../env";

export interface RecordingResult {
  success: boolean;
  skipped?: boolean;
  reason?: string;
  stats?: {
    messagesProcessed: number;
    estimatedTokens: number;
    factsExtracted: number;
    factsRejected: number;
    factsDuplicate: number;
  };
  error?: string;
}

type RecordMemoryResponse = {
  success?: boolean;
  skipped?: boolean;
  reason?: string;
  stats?: {
    messagesProcessed?: number;
    estimatedTokens?: number;
    factsExtracted?: number;
    factsRejected?: number;
    factsDuplicate?: number;
  };
  error?: string;
};

function resolveJobEndpoint(pathname: string): string {
  return new URL(pathname, env.CORE_BASE_URL).toString();
}

export async function processMemoryRecording(
  userId: string,
  email: string,
): Promise<RecordingResult> {
  if (!env.JOBS_SHARED_SECRET) {
    return { success: false, error: "JOBS_SHARED_SECRET not configured" };
  }

  const response = await fetch(resolveJobEndpoint("/api/jobs/record-memory"), {
    method: "POST",
    headers: {
      Authorization: `Bearer ${env.JOBS_SHARED_SECRET}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ userId, email }),
  });

  let payload: RecordMemoryResponse = {};
  try {
    payload = (await response.json()) as RecordMemoryResponse;
  } catch {
    payload = {};
  }

  if (!response.ok) {
    return {
      success: false,
      error:
        typeof payload.error === "string" && payload.error.length > 0
          ? payload.error
          : `record_memory_http_${response.status}`,
    };
  }

  if (payload.skipped) {
    return {
      success: true,
      skipped: true,
      reason: typeof payload.reason === "string" ? payload.reason : "No new messages",
    };
  }

  const stats = payload.stats
    ? {
        messagesProcessed:
          typeof payload.stats.messagesProcessed === "number"
            ? payload.stats.messagesProcessed
            : 0,
        estimatedTokens:
          typeof payload.stats.estimatedTokens === "number"
            ? payload.stats.estimatedTokens
            : 0,
        factsExtracted:
          typeof payload.stats.factsExtracted === "number"
            ? payload.stats.factsExtracted
            : 0,
        factsRejected:
          typeof payload.stats.factsRejected === "number"
            ? payload.stats.factsRejected
            : 0,
        factsDuplicate:
          typeof payload.stats.factsDuplicate === "number"
            ? payload.stats.factsDuplicate
            : 0,
      }
    : undefined;

  return {
    success: payload.success === true,
    ...(stats ? { stats } : {}),
    ...(typeof payload.error === "string" && payload.error.length > 0
      ? { error: payload.error }
      : {}),
  };
}

/**
 * Find users who have accumulated enough unsummarized content.
 * Used by the backup cron job to catch missed triggers.
 */
export async function findUsersNeedingRecording(): Promise<{ id: string; email: string }[]> {
  const TOKEN_THRESHOLD = 120_000;
  const CHARS_PER_TOKEN = 4;
  const CHAR_THRESHOLD = TOKEN_THRESHOLD * CHARS_PER_TOKEN;

  const usersWithContent = await prisma.$queryRaw<{ userId: string; totalChars: bigint }[]>`
    SELECT
      cm."userId",
      SUM(LENGTH(cm.content)) as "totalChars"
    FROM "ConversationMessage" cm
    LEFT JOIN "UserSummary" us ON cm."userId" = us."userId"
    WHERE cm."createdAt" > COALESCE(us."lastMessageAt", '1970-01-01'::timestamp)
    GROUP BY cm."userId"
    HAVING SUM(LENGTH(cm.content)) > ${CHAR_THRESHOLD}
  `;

  if (usersWithContent.length === 0) {
    return [];
  }

  const userIds = usersWithContent.map((u) => u.userId);
  return prisma.user.findMany({
    where: { id: { in: userIds } },
    select: { id: true, email: true },
  });
}
