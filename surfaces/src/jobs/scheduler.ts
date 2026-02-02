/**
 * Background Job Scheduler
 * 
 * Runs cron jobs for background processing:
 * - Embedding queue processing (every 5 minutes)
 * - Memory decay (daily at 3 AM UTC)
 * - Memory recording backup (every 30 minutes - catches missed triggers)
 * 
 * This runs in the surfaces sidecar with no timeout constraints.
 */
import { Cron } from 'croner';
import { processEmbeddingQueue, recoverStaleJobs, getQueueStats } from './embedding-worker';
import { runMemoryDecay, getDecayStats } from './decay-worker';
import { processMemoryRecording, findUsersNeedingRecording } from './recording-worker';

// Track running jobs to prevent overlap
let embeddingJobRunning = false;
let decayJobRunning = false;
let recordingBackupRunning = false;

/**
 * Start the background job scheduler
 * 
 * Registers cron jobs that run automatically at scheduled intervals.
 */
export function startScheduler() {
    console.log('[Scheduler] Starting background job scheduler');

    // Every 5 minutes: process embedding queue
    const embeddingJob = Cron('*/5 * * * *', async () => {
        if (embeddingJobRunning) {
            console.log('[Scheduler] Embedding job already running, skipping');
            return;
        }

        embeddingJobRunning = true;
        console.log('[Scheduler] Running embedding queue processor');

        try {
            // First recover any stale jobs
            const recovered = await recoverStaleJobs();
            if (recovered > 0) {
                console.log(`[Scheduler] Recovered ${recovered} stale jobs`);
            }

            // Process pending jobs
            const processed = await processEmbeddingQueue(50);
            
            // Log stats
            const stats = await getQueueStats();
            console.log(`[Scheduler] Embedding complete - Processed: ${processed}, Queue: ${JSON.stringify(stats)}`);

        } catch (error) {
            console.error('[Scheduler] Embedding job failed:', error);
        } finally {
            embeddingJobRunning = false;
        }
    });

    // Daily at 3:00 AM UTC: memory decay
    const decayJob = Cron('0 3 * * *', async () => {
        if (decayJobRunning) {
            console.log('[Scheduler] Decay job already running, skipping');
            return;
        }

        decayJobRunning = true;
        console.log('[Scheduler] Running memory decay');

        try {
            const result = await runMemoryDecay();
            
            // Log stats
            const stats = await getDecayStats();
            console.log(`[Scheduler] Decay complete - Result: ${JSON.stringify(result)}, Stats: ${JSON.stringify(stats)}`);

        } catch (error) {
            console.error('[Scheduler] Decay job failed:', error);
        } finally {
            decayJobRunning = false;
        }
    });

    // Every 30 minutes: backup memory recording check
    // Catches any missed triggers (network issues, sidecar restart, etc.)
    const recordingBackupJob = Cron('*/30 * * * *', async () => {
        if (recordingBackupRunning) {
            console.log('[Scheduler] Recording backup already running, skipping');
            return;
        }

        recordingBackupRunning = true;
        console.log('[Scheduler] Running memory recording backup check');

        try {
            const usersNeedingRecording = await findUsersNeedingRecording();
            
            if (usersNeedingRecording.length === 0) {
                console.log('[Scheduler] No users need recording backup');
            } else {
                console.log(`[Scheduler] Found ${usersNeedingRecording.length} users needing recording`);
                
                for (const user of usersNeedingRecording) {
                    try {
                        const result = await processMemoryRecording(user.id, user.email);
                        if (result.success && result.stats) {
                            console.log(`[Scheduler] Backup recording for ${user.id}: ${result.stats.factsExtracted} facts`);
                        }
                    } catch (err) {
                        console.error(`[Scheduler] Backup recording failed for ${user.id}:`, err);
                    }
                }
            }

        } catch (error) {
            console.error('[Scheduler] Recording backup check failed:', error);
        } finally {
            recordingBackupRunning = false;
        }
    });

    console.log('[Scheduler] Cron jobs registered:');
    console.log('  - Embedding queue: every 5 minutes');
    console.log('  - Memory decay: daily at 3:00 AM UTC');
    console.log('  - Memory recording backup: every 30 minutes');

    // Return job handles for potential cleanup
    return { embeddingJob, decayJob, recordingBackupJob };
}

/**
 * Manually trigger embedding processing
 * Useful for testing or manual intervention
 */
export async function triggerEmbeddingJob(): Promise<void> {
    if (embeddingJobRunning) {
        console.log('[Scheduler] Embedding job already running');
        return;
    }

    embeddingJobRunning = true;
    try {
        const recovered = await recoverStaleJobs();
        const processed = await processEmbeddingQueue(100); // Process more for manual runs
        const stats = await getQueueStats();
        console.log(`[Scheduler] Manual embedding run - Recovered: ${recovered}, Processed: ${processed}, Queue: ${JSON.stringify(stats)}`);
    } finally {
        embeddingJobRunning = false;
    }
}

/**
 * Manually trigger memory decay
 * Useful for testing or manual intervention
 */
export async function triggerDecayJob(): Promise<void> {
    if (decayJobRunning) {
        console.log('[Scheduler] Decay job already running');
        return;
    }

    decayJobRunning = true;
    try {
        const result = await runMemoryDecay();
        const stats = await getDecayStats();
        console.log(`[Scheduler] Manual decay run - Result: ${JSON.stringify(result)}, Stats: ${JSON.stringify(stats)}`);
    } finally {
        decayJobRunning = false;
    }
}
