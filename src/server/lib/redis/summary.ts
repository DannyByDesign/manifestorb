import { redis } from "@/server/lib/redis";

// TTL for summary cache: 24 hours
const SUMMARY_TTL_SECONDS = 60 * 60 * 24;

export async function getSummary(text: string): Promise<string | null> {
  return redis.get(text);
}

export async function saveSummary(text: string, summary: string) {
  return redis.set(text, summary, { ex: SUMMARY_TTL_SECONDS });
}
