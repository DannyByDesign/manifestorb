/**
 * Memory Decay Worker
 * 
 * Manages the lifecycle of memory facts:
 * 1. Marks stale memories as inactive (soft delete)
 * 2. Permanently deletes old inactive memories (hard delete)
 * 
 * This worker runs in the surfaces sidecar with no timeout constraints.
 */
import { prisma } from '../db/prisma';

// Configuration (must match main app's decay.ts)
const STALE_THRESHOLD_DAYS = 180;  // Mark inactive after 180 days without access
const INACTIVE_PURGE_DAYS = 30;    // Delete after 30 days inactive

export interface DecayResult {
    pruned: number;   // Facts marked as inactive
    purged: number;   // Facts permanently deleted
}

/**
 * Run the memory decay process
 * 
 * 1. Marks facts as inactive if:
 *    - Not accessed in 180+ days, OR
 *    - Past their explicit expiresAt date
 * 
 * 2. Permanently deletes facts that:
 *    - Have been inactive for 30+ days
 */
export async function runMemoryDecay(): Promise<DecayResult> {
    const staleDate = new Date(Date.now() - STALE_THRESHOLD_DAYS * 24 * 60 * 60 * 1000);
    const purgeDate = new Date(Date.now() - INACTIVE_PURGE_DAYS * 24 * 60 * 60 * 1000);
    const now = new Date();

    console.log('[Decay] Starting memory decay process');
    console.log(`[Decay] Stale threshold: ${staleDate.toISOString()}`);
    console.log(`[Decay] Purge threshold: ${purgeDate.toISOString()}`);

    // 1. Mark stale memories as inactive (soft delete)
    const pruned = await prisma.memoryFact.updateMany({
        where: {
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
        },
        data: { isActive: false },
    });

    if (pruned.count > 0) {
        console.log(`[Decay] Pruned ${pruned.count} stale memories`);
    }

    // 2. Permanently delete old inactive memories (hard delete)
    const purged = await prisma.memoryFact.deleteMany({
        where: {
            isActive: false,
            updatedAt: { lt: purgeDate },
        },
    });

    if (purged.count > 0) {
        console.log(`[Decay] Purged ${purged.count} inactive memories`);
    }

    console.log(`[Decay] Complete - Pruned: ${pruned.count}, Purged: ${purged.count}`);

    return {
        pruned: pruned.count,
        purged: purged.count,
    };
}

/**
 * Get decay statistics for monitoring
 */
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
