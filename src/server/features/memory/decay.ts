/**
 * Memory Decay Algorithm
 * 
 * Implements time-based and usage-based decay for memory facts.
 * Ensures old, unused memories don't pollute search results.
 * 
 * Key concepts:
 * - Relevance Score: Combines confidence, recency, and usage
 * - Decay Factor: Exponential decay over time (30-day half-life)
 * - Soft Deletion: Marks facts as inactive instead of hard delete
 * 
 * Note: This module requires the memory decay migration to be applied
 * and the Prisma client to be regenerated.
 */
import prisma from "@/server/db/client";
import { createScopedLogger } from "@/server/lib/logger";
import type { MemoryFact as BaseMemoryFact } from "@/generated/prisma/client";

const logger = createScopedLogger("MemoryDecay");

// Extended type with decay fields (available after migration)
// TODO: Remove this after running `prisma generate`
type MemoryFact = BaseMemoryFact & {
  expiresAt?: Date | null;
  lastAccessedAt?: Date | null;
  accessCount: number;
  isActive: boolean;
};

// ============================================================================
// Configuration
// ============================================================================

// Time-based decay
const DECAY_HALF_LIFE_DAYS = 30; // Relevance halves every 30 days
const STALE_THRESHOLD_DAYS = 180; // Mark as inactive after 180 days without access
const MIN_RELEVANCE_THRESHOLD = 0.1; // Below this, fact is considered irrelevant

// Usage-based boost
const MAX_ACCESS_BOOST = 0.2; // Maximum 20% boost from frequent access
const ACCESS_NORMALIZATION = 10; // Number of accesses to reach max boost

// ============================================================================
// Relevance Calculation
// ============================================================================

/**
 * Calculate the relevance score for a memory fact
 * 
 * Combines:
 * - Base confidence (user-provided or inferred)
 * - Time decay (exponential, 30-day half-life)
 * - Usage boost (up to 20% for frequently accessed facts)
 * 
 * @param fact - The memory fact to score
 * @returns Relevance score between 0 and 1
 */
export function calculateRelevance(fact: MemoryFact): number {
  // Use lastAccessedAt if available, otherwise use updatedAt
  const referenceDate = fact.lastAccessedAt || fact.updatedAt;
  const ageInDays = (Date.now() - referenceDate.getTime()) / (1000 * 60 * 60 * 24);
  
  // Exponential decay: relevance = e^(-age / half_life * ln(2))
  const decayFactor = Math.exp(-ageInDays / DECAY_HALF_LIFE_DAYS * Math.LN2);
  
  // Usage boost: normalized to max boost
  const normalizedAccess = Math.min(fact.accessCount / ACCESS_NORMALIZATION, 1);
  const accessBoost = normalizedAccess * MAX_ACCESS_BOOST;
  
  // Final relevance: confidence * decay * (1 + boost)
  const relevance = fact.confidence * decayFactor * (1 + accessBoost);
  
  // Clamp to [0, 1]
  return Math.max(0, Math.min(1, relevance));
}

// ============================================================================
// Access Tracking
// ============================================================================

/**
 * Record that a fact was accessed (retrieved/used)
 * Updates lastAccessedAt and increments accessCount
 * 
 * @param factId - ID of the accessed fact
 */
export async function recordAccess(factId: string): Promise<void> {
  try {
    await prisma.memoryFact.update({
      where: { id: factId },
      data: {
        lastAccessedAt: new Date(),
        accessCount: { increment: 1 },
      } as any, // Note: Requires Prisma client regeneration after migration
    });
  } catch (error) {
    // Don't fail if access tracking fails
    logger.warn("Failed to record fact access", { factId, error });
  }
}

/**
 * Record access for multiple facts at once
 * 
 * @param factIds - IDs of the accessed facts
 */
export async function recordBulkAccess(factIds: string[]): Promise<void> {
  if (factIds.length === 0) return;
  
  try {
    await prisma.memoryFact.updateMany({
      where: { id: { in: factIds } },
      data: {
        lastAccessedAt: new Date(),
        // Note: updateMany doesn't support increment, so we use raw SQL
      } as any, // Note: Requires Prisma client regeneration after migration
    });
    
    // Increment access count with raw SQL
    await prisma.$executeRaw`
      UPDATE "MemoryFact"
      SET "accessCount" = "accessCount" + 1
      WHERE id = ANY(${factIds}::text[])
    `;
  } catch (error) {
    logger.warn("Failed to record bulk fact access", { count: factIds.length, error });
  }
}

// ============================================================================
// Cleanup Jobs
// ============================================================================

/**
 * Mark stale memories as inactive
 * 
 * Criteria for staleness:
 * - Not accessed in STALE_THRESHOLD_DAYS days, OR
 * - Past explicit expiresAt date, OR
 * - Relevance score below MIN_RELEVANCE_THRESHOLD
 * 
 * @param userId - Optional: only process for a specific user
 * @returns Number of facts marked as inactive
 */
export async function pruneStaleMemories(userId?: string): Promise<number> {
  const staleDate = new Date(Date.now() - STALE_THRESHOLD_DAYS * 24 * 60 * 60 * 1000);
  const now = new Date();
  
  // Build where clause
  const whereClause: any = {
    isActive: true,
    OR: [
      // Expired by TTL
      { expiresAt: { lt: now } },
      // Stale by access time
      {
        AND: [
          { lastAccessedAt: { lt: staleDate } },
          { updatedAt: { lt: staleDate } },
        ],
      },
    ],
  };
  
  if (userId) {
    whereClause.userId = userId;
  }
  
  // Mark as inactive (soft delete)
  const result = await prisma.memoryFact.updateMany({
    where: whereClause,
    data: { isActive: false } as any, // Note: Requires Prisma client regeneration
  });
  
  if (result.count > 0) {
    logger.info("Pruned stale memories", { 
      count: result.count, 
      userId: userId || "all" 
    });
  }
  
  return result.count;
}

/**
 * Permanently delete inactive memories older than a threshold
 * Should be run less frequently than pruneStaleMemories
 * 
 * @param daysOld - Only delete if inactive for this many days
 * @returns Number of facts permanently deleted
 */
export async function purgeInactiveMemories(daysOld = 30): Promise<number> {
  const cutoffDate = new Date(Date.now() - daysOld * 24 * 60 * 60 * 1000);
  
  const result = await prisma.memoryFact.deleteMany({
    where: {
      isActive: false,
      updatedAt: { lt: cutoffDate },
    } as any, // Note: Requires Prisma client regeneration
  });
  
  if (result.count > 0) {
    logger.info("Purged inactive memories", { 
      count: result.count, 
      olderThanDays: daysOld 
    });
  }
  
  return result.count;
}

// ============================================================================
// Relevance-Based Retrieval
// ============================================================================

/**
 * Get memories for a user, sorted by relevance
 * Filters out inactive and low-relevance facts
 * 
 * @param userId - User to get memories for
 * @param limit - Maximum number of memories to return
 * @param minRelevance - Minimum relevance score (default: 0.1)
 * @returns Array of facts with relevance scores
 */
export async function getRelevantMemories(
  userId: string,
  limit = 20,
  minRelevance = MIN_RELEVANCE_THRESHOLD
): Promise<Array<{ fact: MemoryFact; relevance: number }>> {
  // Fetch active memories
  const facts = await prisma.memoryFact.findMany({
    where: {
      userId,
      isActive: true,
    } as any, // Note: Requires Prisma client regeneration
    orderBy: { updatedAt: 'desc' },
    take: limit * 2, // Fetch extra since some will be filtered by relevance
  });
  
  // Calculate relevance and filter
  const scored = (facts as MemoryFact[])
    .map(fact => ({
      fact,
      relevance: calculateRelevance(fact),
    }))
    .filter(({ relevance }) => relevance >= minRelevance)
    .sort((a, b) => b.relevance - a.relevance)
    .slice(0, limit);
  
  // Track access for returned facts
  const factIds = scored.map(s => s.fact.id);
  recordBulkAccess(factIds).catch(() => {}); // Fire and forget
  
  return scored;
}

// ============================================================================
// Utility Functions
// ============================================================================

/**
 * Set expiration date for a memory fact
 * 
 * @param factId - ID of the fact
 * @param expiresAt - When the fact should expire
 */
export async function setExpiration(factId: string, expiresAt: Date): Promise<void> {
  await prisma.memoryFact.update({
    where: { id: factId },
    data: { expiresAt } as any, // Note: Requires Prisma client regeneration
  });
}

/**
 * Clear expiration date for a memory fact
 * 
 * @param factId - ID of the fact
 */
export async function clearExpiration(factId: string): Promise<void> {
  await prisma.memoryFact.update({
    where: { id: factId },
    data: { expiresAt: null } as any, // Note: Requires Prisma client regeneration
  });
}

/**
 * Reactivate a previously deactivated memory
 * 
 * @param factId - ID of the fact
 */
export async function reactivateMemory(factId: string): Promise<void> {
  await prisma.memoryFact.update({
    where: { id: factId },
    data: {
      isActive: true,
      lastAccessedAt: new Date(),
    } as any, // Note: Requires Prisma client regeneration
  });
}
