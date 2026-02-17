import { randomUUID } from "crypto";
import { redis } from "@/server/lib/redis";
import { createScopedLogger } from "@/server/lib/logger";
import { markIndexedDocumentDeleted, upsertIndexedDocument } from "@/server/features/search/index/repository";
import type { SearchDocumentIdentity, SearchIndexedDocument, SearchIndexJob } from "@/server/features/search/index/types";

const logger = createScopedLogger("SearchIndexQueue");

const QUEUE_KEY = "search_index:queue";
const PROCESSING_KEY = "search_index:processing";
const FAILED_KEY = "search_index:failed";
const MAX_RETRIES = 4;
const PROCESSING_TIMEOUT_MS = 60_000;

class SearchIndexTimeoutError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SearchIndexTimeoutError";
  }
}

function nowMs(): number {
  return Date.now();
}

function parseJob(raw: unknown): SearchIndexJob {
  if (typeof raw !== "string") {
    throw new Error("search_index_job_invalid_payload");
  }
  return JSON.parse(raw) as SearchIndexJob;
}

export class SearchIndexQueue {
  static async enqueueUpsert(document: SearchIndexedDocument): Promise<string> {
    const id = `sidx_${nowMs()}_${randomUUID().slice(0, 8)}`;
    const job: SearchIndexJob = {
      id,
      kind: "upsert_document",
      payload: document,
      retries: 0,
      createdAt: nowMs(),
    };
    await redis.lpush(QUEUE_KEY, JSON.stringify(job));
    return id;
  }

  static async enqueueDelete(identity: SearchDocumentIdentity): Promise<string> {
    const id = `sidx_${nowMs()}_${randomUUID().slice(0, 8)}`;
    const job: SearchIndexJob = {
      id,
      kind: "delete_document",
      payload: identity,
      retries: 0,
      createdAt: nowMs(),
    };
    await redis.lpush(QUEUE_KEY, JSON.stringify(job));
    return id;
  }

  static async processNext(): Promise<boolean> {
    const jobJson = await redis.rpop(QUEUE_KEY);
    if (!jobJson) return false;

    await redis.lpush(PROCESSING_KEY, jobJson);

    const job = parseJob(jobJson);
    try {
      await Promise.race([
        this.process(job),
        new Promise<never>((_, reject) =>
          setTimeout(() => reject(new SearchIndexTimeoutError("search_index_job_timeout")), PROCESSING_TIMEOUT_MS),
        ),
      ]);

      await redis.lrem(PROCESSING_KEY, 1, jobJson);
      return true;
    } catch (error) {
      await redis.lrem(PROCESSING_KEY, 1, jobJson);
      const message = error instanceof Error ? error.message : "search_index_job_failed";
      logger.error("Search index job failed", {
        jobId: job.id,
        kind: job.kind,
        retries: job.retries,
        error: message,
      });

      if (job.retries < MAX_RETRIES) {
        const retryJob: SearchIndexJob = {
          ...job,
          retries: job.retries + 1,
          lastError: message,
        };
        await redis.lpush(QUEUE_KEY, JSON.stringify(retryJob));
      } else {
        await redis.lpush(
          FAILED_KEY,
          JSON.stringify({
            ...job,
            lastError: message,
          } satisfies SearchIndexJob),
        );
      }
      return true;
    }
  }

  private static async process(job: SearchIndexJob) {
    if (job.kind === "upsert_document") {
      await upsertIndexedDocument({
        document: job.payload,
      });
      return;
    }
    await markIndexedDocumentDeleted(job.payload);
  }

  static async processAll(maxJobs = 200): Promise<number> {
    let processed = 0;
    while (processed < maxJobs) {
      const hadJob = await this.processNext();
      if (!hadJob) break;
      processed += 1;
    }
    return processed;
  }

  static async recoverStale(): Promise<number> {
    const jobs = await redis.lrange(PROCESSING_KEY, 0, -1);
    let recovered = 0;
    for (const jobJson of jobs) {
      const job = parseJob(jobJson);
      const ageMs = nowMs() - job.createdAt;
      if (ageMs <= PROCESSING_TIMEOUT_MS) continue;
      await redis.lrem(PROCESSING_KEY, 1, jobJson);
      await redis.lpush(QUEUE_KEY, jobJson);
      recovered += 1;
    }
    return recovered;
  }

  static async retryFailed(): Promise<number> {
    let moved = 0;
    while (true) {
      const raw = await redis.rpop(FAILED_KEY);
      if (!raw) break;
      const job = parseJob(raw);
      const resetJob: SearchIndexJob = {
        ...job,
        retries: 0,
        lastError: undefined,
      };
      await redis.lpush(QUEUE_KEY, JSON.stringify(resetJob));
      moved += 1;
    }
    return moved;
  }

  static async getStats(): Promise<{
    pending: number;
    processing: number;
    failed: number;
  }> {
    const [pending, processing, failed] = await Promise.all([
      redis.llen(QUEUE_KEY),
      redis.llen(PROCESSING_KEY),
      redis.llen(FAILED_KEY),
    ]);
    return { pending, processing, failed };
  }
}
