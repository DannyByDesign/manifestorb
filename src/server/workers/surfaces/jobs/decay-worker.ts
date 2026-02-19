/**
 * Memory Decay Worker bridge
 *
 * Worker runtime delegates decay execution to the canonical core API job
 * implementation so lifecycle logic is defined in one place.
 */
import { prisma } from "../db/prisma";
import { env } from "../env";

const STALE_THRESHOLD_DAYS = 180;

export interface DecayResult {
  pruned: number;
  purged: number;
}

type DecayJobResponse = {
  success?: boolean;
  pruned?: number;
  purged?: number;
};

function resolveJobEndpoint(pathname: string): string {
  return new URL(pathname, env.CORE_BASE_URL).toString();
}

export async function runMemoryDecay(): Promise<DecayResult> {
  if (!env.JOBS_SHARED_SECRET) {
    throw new Error("JOBS_SHARED_SECRET not configured");
  }

  const response = await fetch(resolveJobEndpoint("/api/jobs/memory-decay"), {
    method: "POST",
    headers: {
      Authorization: `Bearer ${env.JOBS_SHARED_SECRET}`,
    },
  });

  let payload: DecayJobResponse = {};
  try {
    payload = (await response.json()) as DecayJobResponse;
  } catch {
    payload = {};
  }

  if (!response.ok || payload.success !== true) {
    const body = JSON.stringify(payload).slice(0, 500);
    throw new Error(`decay_job_failed:${response.status}:${body}`);
  }

  return {
    pruned: typeof payload.pruned === "number" ? payload.pruned : 0,
    purged: typeof payload.purged === "number" ? payload.purged : 0,
  };
}

export async function getDecayStats(): Promise<{
  totalFacts: number;
  activeFacts: number;
  inactiveFacts: number;
  staleFacts: number;
}> {
  const staleDate = new Date(Date.now() - STALE_THRESHOLD_DAYS * 24 * 60 * 60 * 1000);

  const [total, active, inactive, stale] = await Promise.all([
    prisma.memoryFact.count(),
    prisma.memoryFact.count({ where: { isActive: true } }),
    prisma.memoryFact.count({ where: { isActive: false } }),
    prisma.memoryFact.count({
      where: {
        isActive: true,
        OR: [
          { lastAccessedAt: { lt: staleDate } },
          { updatedAt: { lt: staleDate } },
        ],
      },
    }),
  ]);

  return {
    totalFacts: total,
    activeFacts: active,
    inactiveFacts: inactive,
    staleFacts: stale,
  };
}
