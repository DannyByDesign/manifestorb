/**
 * Memory management tools for AI agents
 * Enables autonomous learning and recall of user facts
 * 
 * Part of the context and memory management system.
 * 
 * Features:
 * - Key normalization for deduplication
 * - Quality validation to prevent garbage data
 * - Reliable embedding queue (no fire-and-forget)
 * - PostHog analytics integration
 */
import { tool } from "ai";
import { z } from "zod";
import prisma from "@/server/db/client";
import type { Logger } from "@/server/lib/logger";
import { posthogCaptureEvent } from "@/server/lib/posthog";
import { EmbeddingService } from "@/features/memory/embeddings/service";
import { EmbeddingQueue } from "@/features/memory/embeddings/queue";

export interface MemoryToolOptions {
  userId: string;
  email: string;
  logger: Logger;
}

// ============================================================================
// Key Normalization
// ============================================================================

/**
 * Normalize a key for consistent storage and deduplication
 * - Lowercase
 * - Replace spaces with underscores
 * - Remove special characters
 * - Trim whitespace
 */
function normalizeKey(key: string): string {
  return key
    .trim()
    .toLowerCase()
    .replace(/\s+/g, '_')
    .replace(/[^a-z0-9_]/g, '')
    .slice(0, 100); // Enforce max length
}

// ============================================================================
// Quality Validation
// ============================================================================

const BLOCKED_PATTERNS = [
  /^(test|asdf|xxx|placeholder|example|sample)/i,
  /^.{1,2}$/, // Too short
  /password|secret|api.?key|credit.?card|ssn|social.?security/i, // Sensitive data
  /^\d+$/, // Just numbers
];

interface ValidationResult {
  valid: boolean;
  reason?: string;
}

/**
 * Validate fact quality before storing
 */
function validateFactQuality(key: string, value: string): ValidationResult {
  // Check key format after normalization
  const normalizedKey = normalizeKey(key);
  if (normalizedKey.length < 3) {
    return { valid: false, reason: 'Key too short after normalization' };
  }
  
  if (!/^[a-z][a-z0-9_]*$/.test(normalizedKey)) {
    return { valid: false, reason: 'Key must start with a letter and contain only letters, numbers, underscores' };
  }
  
  // Check value quality
  const trimmedValue = value.trim();
  if (trimmedValue.length < 2) {
    return { valid: false, reason: 'Value too short' };
  }
  
  // Check for blocked patterns
  for (const pattern of BLOCKED_PATTERNS) {
    if (pattern.test(normalizedKey) || pattern.test(trimmedValue)) {
      return { valid: false, reason: 'Content blocked by quality filter' };
    }
  }
  
  return { valid: true };
}

async function trackToolCall({
  tool: toolName,
  email,
  logger,
}: {
  tool: string;
  email: string;
  logger: Logger;
}) {
  logger.info("Memory tool call", { tool: toolName, email });
  return posthogCaptureEvent(email, "AI Assistant Memory Tool Call", { tool: toolName });
}

/**
 * Tool: Remember a fact about the user
 */
export const rememberFactTool = ({ userId, email, logger }: MemoryToolOptions) =>
  tool({
    description:
      "Store an important fact about the user for future reference. " +
      "Use this when the user shares preferences, important dates, contacts, " +
      "or any information they might want you to remember. " +
      "The key should be a category like 'preference_tone', 'contact_boss', 'deadline_project_x'.",
    parameters: z.object({
      key: z.string()
        .min(3)
        .max(100)
        .describe("Category identifier (e.g., 'preference_email_tone', 'contact_manager_name')"),
      value: z.string()
        .min(1)
        .max(1000)
        .describe("The fact to remember (e.g., 'formal and professional', 'Sarah Johnson')"),
      confidence: z.number()
        .min(0)
        .max(1)
        .optional()
        .describe("How confident you are about this fact (0-1). Default: 0.8")
    }),
    execute: async ({ key, value, confidence = 0.8 }: { key: string; value: string; confidence?: number }) => {
      trackToolCall({ tool: "remember_fact", email, logger });

      // Normalize key for deduplication
      const normalizedKey = normalizeKey(key);
      const trimmedValue = value.trim();
      
      // Validate quality
      const validation = validateFactQuality(key, trimmedValue);
      if (!validation.valid) {
        logger.warn("Memory fact rejected by quality filter", { 
          key, normalizedKey, reason: validation.reason 
        });
        return {
          success: false,
          error: `Cannot store this fact: ${validation.reason}`
        };
      }

      try {
        // Use transaction to ensure consistency
        const result = await prisma.$transaction(async (tx) => {
          const fact = await tx.memoryFact.upsert({
            where: {
              userId_key: { userId, key: normalizedKey }
            },
            update: {
              value: trimmedValue,
              confidence,
              updatedAt: new Date()
            },
            create: {
              userId,
              key: normalizedKey,
              value: trimmedValue,
              scope: "global",
              confidence,
              sourceMessageId: null
            }
          });
          
          return fact;
        });

        logger.info("Memory fact saved", { 
          key: normalizedKey, 
          originalKey: key,
          userId, 
          factId: result.id 
        });

        // Queue embedding generation (reliable, not fire-and-forget)
        if (EmbeddingService.isAvailable()) {
          try {
            await EmbeddingQueue.enqueue({
              table: "MemoryFact",
              recordId: result.id,
              text: `${normalizedKey}: ${trimmedValue}`,
              email,
            });
            logger.trace("Embedding job queued", { factId: result.id });
          } catch (e) {
            // Log but don't fail - embedding can be generated later via backfill
            logger.warn("Failed to queue embedding job", { error: e, factId: result.id });
          }
        }

        // Track in PostHog
        posthogCaptureEvent(email, "memory_fact_created", {
          key: normalizedKey,
          confidence,
          source: "agent_tool",
          valueLength: trimmedValue.length,
        }).catch(() => {}); // Fire and forget analytics

        return {
          success: true,
          message: `I'll remember that: ${normalizedKey} = ${trimmedValue}`,
          factId: result.id
        };
      } catch (error) {
        logger.error("Failed to save memory fact", { error, key: normalizedKey, userId });
        return {
          success: false,
          error: "Failed to save memory"
        };
      }
    }
  } as any);

/**
 * Tool: Recall facts about the user
 */
export const recallFactsTool = ({ userId, email, logger }: MemoryToolOptions) =>
  tool({
    description:
      "Search for previously remembered facts about the user. " +
      "Use this when you need to recall something the user told you before.",
    parameters: z.object({
      query: z.string()
        .min(1)
        .max(200)
        .describe("What to search for in memories")
    }),
    execute: async ({ query }: { query: string }) => {
      trackToolCall({ tool: "recall_facts", email, logger });

      const trimmedQuery = query.trim().toLowerCase();

      try {
        const facts = await prisma.memoryFact.findMany({
          where: {
            userId,
            OR: [
              { key: { contains: trimmedQuery, mode: 'insensitive' } },
              { value: { contains: trimmedQuery, mode: 'insensitive' } }
            ]
          },
          orderBy: { updatedAt: 'desc' },
          take: 10
        });

        // Track in PostHog
        posthogCaptureEvent(email, "memory_facts_recalled", {
          query: trimmedQuery.slice(0, 100), // Truncate for privacy
          resultCount: facts.length,
          matchType: facts.length > 0 ? "found" : "empty",
        }).catch(() => {});

        if (facts.length === 0) {
          return {
            facts: [],
            message: "No matching memories found"
          };
        }

        return {
          facts: facts.map(f => ({
            key: f.key,
            value: f.value,
            confidence: f.confidence,
            lastUpdated: f.updatedAt.toISOString()
          })),
          message: `Found ${facts.length} related memories`
        };
      } catch (error) {
        logger.error("Failed to recall facts", { error, query: trimmedQuery, userId });
        return {
          facts: [],
          error: "Failed to search memories"
        };
      }
    }
  } as any);

/**
 * Tool: Forget a specific fact
 */
export const forgetFactTool = ({ userId, email, logger }: MemoryToolOptions) =>
  tool({
    description:
      "Remove a previously stored fact when the user asks you to forget something. " +
      "Only use this when explicitly requested by the user.",
    parameters: z.object({
      key: z.string()
        .describe("The fact key to forget")
    }),
    execute: async ({ key }: { key: string }) => {
      trackToolCall({ tool: "forget_fact", email, logger });

      // Try both original and normalized key
      const normalizedKey = normalizeKey(key);

      try {
        const deleted = await prisma.memoryFact.deleteMany({
          where: { 
            userId, 
            OR: [
              { key },
              { key: normalizedKey }
            ]
          }
        });

        if (deleted.count === 0) {
          return {
            success: false,
            message: `No memory found with key: ${key}`
          };
        }

        logger.info("Memory fact deleted", { key, normalizedKey, userId, count: deleted.count });

        // Track in PostHog
        posthogCaptureEvent(email, "memory_fact_deleted", {
          key: normalizedKey,
          reason: "user_requested",
        }).catch(() => {});

        return {
          success: true,
          message: `Forgot: ${key}`
        };
      } catch (error) {
        logger.error("Failed to delete memory fact", { error, key, userId });
        return {
          success: false,
          error: "Failed to forget memory"
        };
      }
    }
  } as any);

/**
 * Tool: List all remembered facts
 */
export const listFactsTool = ({ userId, email, logger }: MemoryToolOptions) =>
  tool({
    description:
      "List all facts remembered about the user. " +
      "Use this when the user asks what you know about them.",
    parameters: z.object({
      limit: z.number()
        .min(1)
        .max(50)
        .optional()
        .describe("Maximum number of facts to return. Default: 20")
    }),
    execute: async ({ limit = 20 }: { limit?: number }) => {
      trackToolCall({ tool: "list_facts", email, logger });

      try {
        const facts = await prisma.memoryFact.findMany({
          where: { userId },
          orderBy: { updatedAt: 'desc' },
          take: limit
        });

        return {
          facts: facts.map(f => ({
            key: f.key,
            value: f.value,
            confidence: f.confidence,
            lastUpdated: f.updatedAt.toISOString()
          })),
          total: facts.length,
          message: facts.length > 0
            ? `I remember ${facts.length} things about you`
            : "I don't have any memories stored yet"
        };
      } catch (error) {
        logger.error("Failed to list facts", { error, userId });
        return {
          facts: [],
          error: "Failed to list memories"
        };
      }
    }
  } as any);

/**
 * Creates all memory management tools with the given options
 */
export function createMemoryTools(options: MemoryToolOptions) {
  return {
    rememberFact: rememberFactTool(options),
    recallFacts: recallFactsTool(options),
    forgetFact: forgetFactTool(options),
    listFacts: listFactsTool(options),
  };
}
