import type { Logger } from "@/server/lib/logger";
import { EmbeddingQueue } from "@/features/memory/embeddings/queue";
import { EmbeddingService } from "@/features/memory/embeddings/service";

const SENSITIVE_PATTERNS = [
  /password|secret|api.?key|private.?key/i,
  /\b\d{3}-\d{2}-\d{4}\b/, // US SSN
  /\b\d{4}[\s-]?\d{4}[\s-]?\d{4}[\s-]?\d{4}\b/, // Card-like sequences
];

function shouldSkipEmbedding(content: string): boolean {
  return SENSITIVE_PATTERNS.some((pattern) => pattern.test(content));
}

export async function enqueueConversationMessageEmbedding(params: {
  recordId: string;
  content: string;
  role: "user" | "assistant" | "system" | "tool";
  email?: string;
  logger?: Logger;
}): Promise<boolean> {
  if (!EmbeddingService.isAvailable()) return false;

  const normalized = params.content.trim();
  if (!normalized) return false;
  if (shouldSkipEmbedding(normalized)) {
    params.logger?.warn("Skipping conversation embedding due to sensitive pattern", {
      conversationMessageId: params.recordId,
      role: params.role,
    });
    return false;
  }

  const text = `${params.role}: ${normalized}`;
  await EmbeddingQueue.enqueue({
    table: "ConversationMessage",
    recordId: params.recordId,
    text,
    email: params.email,
  });

  params.logger?.trace("Conversation embedding enqueued", {
    conversationMessageId: params.recordId,
    role: params.role,
  });
  return true;
}
