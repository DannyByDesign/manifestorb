import type { ToolResult } from "@/server/features/ai/tools/types";
import type { CapabilityEnvironment } from "@/server/features/ai/tools/runtime/capabilities/types";
import prisma from "@/server/db/client";
import { capabilityFailureResult } from "@/server/features/ai/tools/runtime/capabilities/errors";
import { EmbeddingQueue } from "@/features/memory/embeddings/queue";
import { EmbeddingService } from "@/features/memory/embeddings/service";
import { orchestrateMemoryRetrieval } from "@/server/features/memory/retrieval/orchestrator";
import {
  enqueueMemoryDeleteForIndexing,
  enqueueMemoryFactForIndexing,
} from "@/server/features/search/index/ingestors/memory";

const BLOCKED_PATTERNS = [
  /^(test|asdf|xxx|placeholder|example|sample)/i,
  /^.{1,2}$/,
  /password|secret|api.?key|credit.?card|ssn|social.?security/i,
  /^\d+$/,
];

export interface MemoryCapabilities {
  remember(input: { key: string; value: string; confidence?: number }): Promise<ToolResult>;
  recall(input: { query: string; limit?: number; minScore?: number }): Promise<ToolResult>;
  forget(key: string): Promise<ToolResult>;
  list(limit?: number): Promise<ToolResult>;
}

function normalizeKey(key: string): string {
  return key
    .trim()
    .toLowerCase()
    .replace(/\s+/g, "_")
    .replace(/[^a-z0-9_]/g, "")
    .slice(0, 100);
}

function validateFactQuality(key: string, value: string): string | null {
  const normalizedKey = normalizeKey(key);
  if (normalizedKey.length < 3) {
    return "memory_key_too_short";
  }

  if (!/^[a-z][a-z0-9_]*$/.test(normalizedKey)) {
    return "memory_key_invalid";
  }

  const trimmedValue = value.trim();
  if (trimmedValue.length < 2) {
    return "memory_value_too_short";
  }

  for (const pattern of BLOCKED_PATTERNS) {
    if (pattern.test(normalizedKey) || pattern.test(trimmedValue)) {
      return "memory_blocked_by_quality_filter";
    }
  }

  return null;
}

function memoryFailure(error: unknown, message: string): ToolResult {
  return capabilityFailureResult(error, message, {
    resource: "memory",
  });
}

export function createMemoryCapabilities(env: CapabilityEnvironment): MemoryCapabilities {
  return {
    async remember(input) {
      const key = normalizeKey(input.key);
      const value = input.value.trim();
      const confidence =
        typeof input.confidence === "number"
          ? Math.min(Math.max(input.confidence, 0), 1)
          : 0.8;

      const qualityError = validateFactQuality(key, value);
      if (qualityError) {
        return {
          success: false,
          error: qualityError,
          message: "I couldn't store that memory because it looked low quality or sensitive.",
        };
      }

      try {
        const fact = await prisma.memoryFact.upsert({
          where: {
            userId_key: {
              userId: env.runtime.userId,
              key,
            },
          },
          update: {
            value,
            confidence,
            isActive: true,
            updatedAt: new Date(),
          },
          create: {
            userId: env.runtime.userId,
            key,
            value,
            scope: "global",
            confidence,
            sourceMessageId: null,
            isActive: true,
          },
        });

        if (EmbeddingService.isAvailable()) {
          EmbeddingQueue.enqueue({
            table: "MemoryFact",
            recordId: fact.id,
            text: `${key}: ${value}`,
            email: env.runtime.email,
          }).catch((error) => {
            env.runtime.logger.warn("Failed to queue memory fact embedding", {
              error,
              factId: fact.id,
            });
          });
        }

        void enqueueMemoryFactForIndexing({
          userId: env.runtime.userId,
          fact,
          logger: env.runtime.logger,
        });

        return {
          success: true,
          message: `I will remember that (${key}).`,
          data: {
            key,
            value,
            confidence,
            factId: fact.id,
          },
          meta: {
            resource: "memory",
            itemCount: 1,
          },
        };
      } catch (error) {
        return memoryFailure(error, "I ran into a problem while saving that memory.");
      }
    },

    async recall(input) {
      const query = input.query.trim();
      if (!query) {
        return {
          success: false,
          error: "memory_query_required",
          clarification: {
            kind: "missing_fields",
            prompt: "memory_query_required",
            missingFields: ["query"],
          },
        };
      }

      const limit = Math.max(1, Math.min(25, Math.trunc(input.limit ?? 8)));
      const minScore = Math.min(Math.max(input.minScore ?? 0.15, 0), 1);

      try {
        const retrieval = await orchestrateMemoryRetrieval({
          userId: env.runtime.userId,
          query,
          limit,
          surface: env.runtime.provider,
        });

        const facts = retrieval.semanticFacts
          .filter((fact) => fact.score >= minScore)
          .slice(0, limit);

        return {
          success: true,
          message:
            facts.length > 0
              ? `Found ${facts.length} memory match${facts.length === 1 ? "" : "es"}.`
              : "I couldn't find a close memory match.",
          data: {
            query,
            minScore,
            intent: retrieval.intent,
            confidence: retrieval.confidence,
            summary: retrieval.summary,
            facts,
            citations: retrieval.citations,
            structured: retrieval.structured,
            conversationMatches: retrieval.semanticConversation.slice(0, limit),
          },
          meta: {
            resource: "memory",
            itemCount: retrieval.citations.length,
          },
        };
      } catch (error) {
        return memoryFailure(error, "I couldn't search memory right now.");
      }
    },

    async forget(keyInput) {
      const key = normalizeKey(keyInput);
      if (!key) {
        return {
          success: false,
          error: "memory_key_required",
          clarification: {
            kind: "missing_fields",
            prompt: "memory_key_required",
            missingFields: ["key"],
          },
        };
      }

      try {
        const existingFacts = await prisma.memoryFact.findMany({
          where: {
            userId: env.runtime.userId,
            OR: [{ key: keyInput }, { key }],
          },
          select: { id: true },
        });
        const result = await prisma.memoryFact.updateMany({
          where: {
            userId: env.runtime.userId,
            OR: [{ key: keyInput }, { key }],
          },
          data: {
            isActive: false,
            updatedAt: new Date(),
          },
        });

        if (result.count === 0) {
          return {
            success: false,
            error: "memory_not_found",
            message: `I couldn't find memory key ${keyInput}.`,
          };
        }

        for (const fact of existingFacts) {
          void enqueueMemoryDeleteForIndexing({
            identity: {
              userId: env.runtime.userId,
              connector: "memory",
              sourceType: "memory_fact",
              sourceId: fact.id,
            },
            logger: env.runtime.logger,
          });
        }

        return {
          success: true,
          message: `Forgot memory key ${keyInput}.`,
          meta: {
            resource: "memory",
            itemCount: result.count,
          },
        };
      } catch (error) {
        return memoryFailure(error, "I couldn't forget that memory right now.");
      }
    },

    async list(limitInput) {
      const limit = Math.max(1, Math.min(50, Math.trunc(limitInput ?? 20)));
      try {
        const facts = await prisma.memoryFact.findMany({
          where: {
            userId: env.runtime.userId,
            isActive: true,
          },
          orderBy: { updatedAt: "desc" },
          take: limit,
        });

        return {
          success: true,
          message:
            facts.length > 0
              ? `I remember ${facts.length} fact${facts.length === 1 ? "" : "s"}.`
              : "I don't have stored memories yet.",
          data: {
            facts: facts.map((fact) => ({
              key: fact.key,
              value: fact.value,
              confidence: fact.confidence,
              updatedAt: fact.updatedAt.toISOString(),
            })),
          },
          meta: {
            resource: "memory",
            itemCount: facts.length,
          },
        };
      } catch (error) {
        return memoryFailure(error, "I couldn't list memories right now.");
      }
    },
  };
}
