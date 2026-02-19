/**
 * Embedding Queue Worker bridge
 *
 * Worker runtime delegates embedding processing to the canonical core API job
 * implementation so queue logic is defined in one place.
 */
import { env } from "../env";

type EmbeddingQueueStats = {
  pending: number;
  processing: number;
  failed: number;
};

type EmbeddingJobResponse = {
  success?: boolean;
  recovered?: number;
  processed?: number;
  queue?: EmbeddingQueueStats;
};

function resolveJobEndpoint(pathname: string): string {
  return new URL(pathname, env.CORE_BASE_URL).toString();
}

async function callEmbeddingJob(): Promise<EmbeddingJobResponse> {
  if (!env.JOBS_SHARED_SECRET) {
    throw new Error("JOBS_SHARED_SECRET not configured");
  }

  const response = await fetch(resolveJobEndpoint("/api/jobs/process-embeddings"), {
    method: "POST",
    headers: {
      Authorization: `Bearer ${env.JOBS_SHARED_SECRET}`,
    },
  });

  let payload: EmbeddingJobResponse = {};
  try {
    payload = (await response.json()) as EmbeddingJobResponse;
  } catch {
    payload = {};
  }

  if (!response.ok || payload.success !== true) {
    const body = JSON.stringify(payload).slice(0, 500);
    throw new Error(`embedding_job_failed:${response.status}:${body}`);
  }

  return payload;
}

export async function processEmbeddingQueue(maxJobs = 50): Promise<number> {
  void maxJobs;
  const payload = await callEmbeddingJob();
  return typeof payload.processed === "number" ? payload.processed : 0;
}

export async function recoverStaleJobs(): Promise<number> {
  const payload = await callEmbeddingJob();
  return typeof payload.recovered === "number" ? payload.recovered : 0;
}

export async function getQueueStats(): Promise<EmbeddingQueueStats> {
  const payload = await callEmbeddingJob();
  const queue = payload.queue;

  if (!queue) {
    return { pending: 0, processing: 0, failed: 0 };
  }

  return {
    pending: typeof queue.pending === "number" ? queue.pending : 0,
    processing: typeof queue.processing === "number" ? queue.processing : 0,
    failed: typeof queue.failed === "number" ? queue.failed : 0,
  };
}
