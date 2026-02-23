import type { LanguageModelUsage } from "ai";
import { redis } from "@/server/lib/redis";
import { createScopedLogger } from "@/server/lib/logger";

const logger = createScopedLogger("redis/usage");

// TTL for usage tracking: 90 days
const USAGE_TTL_SECONDS = 90 * 24 * 60 * 60;

// Embedding model costs (per 1M tokens)
const EMBEDDING_COSTS: Record<string, number> = {
  "text-embedding-3-small": 0.02,
  "text-embedding-3-large": 0.13,
};

export type RedisUsage = {
  openaiCalls?: number;
  openaiTokensUsed?: number;
  openaiCompletionTokensUsed?: number;
  openaiPromptTokensUsed?: number;
  cachedInputTokensUsed?: number;
  reasoningTokensUsed?: number;
  cost?: number;
  // Embedding-specific tracking
  embeddingCalls?: number;
  embeddingTokensUsed?: number;
  embeddingCost?: number;
};

function getUsageKey(email: string) {
  return `usage:${email}`;
}

export async function getUsage(options: { email: string }) {
  const key = getUsageKey(options.email);
  const data = await redis.hgetall<RedisUsage>(key);
  return data;
}

export async function saveUsage(options: {
  email: string;
  usage: LanguageModelUsage;
  cost: number;
}) {
  const { email, usage, cost } = options;

  const key = getUsageKey(email);

  await Promise.all([
    // TODO: this isn't openai specific, it can be any llm
    redis.hincrby(key, "openaiCalls", 1),
    usage.totalTokens
      ? redis.hincrby(key, "openaiTokensUsed", usage.totalTokens)
      : null,
    usage.outputTokens
      ? redis.hincrby(key, "openaiCompletionTokensUsed", usage.outputTokens)
      : null,
    usage.inputTokens
      ? redis.hincrby(key, "openaiPromptTokensUsed", usage.inputTokens)
      : null,
    usage.cachedInputTokens
      ? redis.hincrby(key, "cachedInputTokensUsed", usage.cachedInputTokens)
      : null,
    usage.reasoningTokens
      ? redis.hincrby(key, "reasoningTokensUsed", usage.reasoningTokens)
      : null,
    cost ? redis.hincrbyfloat(key, "cost", cost) : null,
    // Refresh TTL on each update to allow rolling 90-day window
    redis.expire(key, USAGE_TTL_SECONDS),
  ]).catch((error) => {
    logger.error("Error saving usage", { error: error.message, cost, usage });
  });
}

/**
 * Save embedding API usage for cost tracking
 * 
 * @param email - User email for tracking
 * @param inputChars - Number of input characters (converted to tokens)
 * @param model - Embedding model used (default: text-embedding-3-small)
 */
export async function saveEmbeddingUsage(options: {
  email: string;
  inputChars: number;
  model?: string;
}) {
  const { email, inputChars, model = "text-embedding-3-small" } = options;
  
  // Estimate tokens: roughly 4 characters per token
  const estimatedTokens = Math.ceil(inputChars / 4);
  
  // Calculate cost
  const costPerMillion = EMBEDDING_COSTS[model] || EMBEDDING_COSTS["text-embedding-3-small"];
  const cost = (estimatedTokens / 1_000_000) * costPerMillion;
  
  const key = getUsageKey(email);
  
  await Promise.all([
    redis.hincrby(key, "embeddingCalls", 1),
    redis.hincrby(key, "embeddingTokensUsed", estimatedTokens),
    redis.hincrbyfloat(key, "embeddingCost", cost),
    // Also add to total cost
    redis.hincrbyfloat(key, "cost", cost),
    redis.expire(key, USAGE_TTL_SECONDS),
  ]).catch((error) => {
    logger.error("Error saving embedding usage", { error: error.message, estimatedTokens, cost });
  });
}
