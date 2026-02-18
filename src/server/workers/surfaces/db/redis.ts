/**
 * Redis Client for Surfaces Worker
 * 
 * Connects to the same Redis instance as the main app.
 * Used for the embedding job queue.
 */
import Redis from 'ioredis';
import { env } from "../env";

const redisUrl = env.REDIS_URL;

// Create Redis client if URL is configured
let redisClient: Redis | null = null;
if (redisUrl) {
    try {
        redisClient = new Redis(redisUrl, {
            maxRetriesPerRequest: 3,
            retryStrategy(times) {
                if (times > 3) {
                    console.error('[Redis] Max retries reached, giving up');
                    return null;
                }
                const delay = Math.min(times * 200, 2000);
                console.log(`[Redis] Retrying connection in ${delay}ms...`);
                return delay;
            },
            lazyConnect: true
        });
    } catch (err) {
        console.error("[Redis] Invalid REDIS_URL. Continuing without Redis.", {
            error: err instanceof Error ? err.message : String(err),
        });
        redisClient = null;
    }
}

export const redis = redisClient;

// Log connection status
if (redis) {
    redis.on('connect', () => {
        console.log('[Redis] Connected');
    });
    
    redis.on('error', (err) => {
        console.error('[Redis] Connection error:', err.message);
    });
}

export default redis;
