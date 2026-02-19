import { redis } from "./db/redis";
import { env } from "./env";

const CORE_BASE_URL = env.CORE_BASE_URL;
const SHARED_SECRET = env.SURFACES_SHARED_SECRET;
const DELIVERY_DEDUPE_TTL_MS = Math.max(
  60_000,
  Number(process.env.SURFACES_DELIVERY_DEDUPE_TTL_MS || 7 * 24 * 60 * 60 * 1000),
);
const DELIVERY_DEDUPE_KEY_PREFIX =
  process.env.SURFACES_DELIVERY_DEDUPE_KEY_PREFIX || "surfaces:delivery:response";

const deliveryDedupeFallback = new Map<string, number>();

function keyFor(provider: "slack" | "discord" | "telegram", responseId: string): string {
  return `${DELIVERY_DEDUPE_KEY_PREFIX}:${provider}:${responseId}`;
}

export async function hasSurfaceResponseBeenDelivered(params: {
  provider: "slack" | "discord" | "telegram";
  responseId: string;
}): Promise<boolean> {
  const key = keyFor(params.provider, params.responseId);

  if (redis) {
    try {
      const value = await redis.get(key);
      return value === "1";
    } catch (error) {
      console.warn("[Surfaces][Delivery] Failed to read delivery dedupe key", {
        provider: params.provider,
        responseId: params.responseId,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  const expiresAt = deliveryDedupeFallback.get(key);
  if (!expiresAt) return false;
  if (expiresAt < Date.now()) {
    deliveryDedupeFallback.delete(key);
    return false;
  }
  return true;
}

export async function markSurfaceResponseDelivered(params: {
  provider: "slack" | "discord" | "telegram";
  responseId: string;
}): Promise<void> {
  const key = keyFor(params.provider, params.responseId);

  if (redis) {
    try {
      await redis.set(key, "1", "PX", DELIVERY_DEDUPE_TTL_MS);
      return;
    } catch (error) {
      console.warn("[Surfaces][Delivery] Failed to write delivery dedupe key", {
        provider: params.provider,
        responseId: params.responseId,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  deliveryDedupeFallback.set(key, Date.now() + DELIVERY_DEDUPE_TTL_MS);
}

export async function acknowledgeSurfaceDelivery(params: {
  responseId: string;
  provider: "slack" | "discord" | "telegram";
  providerMessageId: string;
  channelId: string;
  threadId?: string;
}): Promise<void> {
  const response = await fetch(`${CORE_BASE_URL}/api/surfaces/inbound/ack`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-surfaces-secret": SHARED_SECRET,
    },
    body: JSON.stringify({
      responseId: params.responseId,
      provider: params.provider,
      providerMessageId: params.providerMessageId,
      channelId: params.channelId,
      threadId: params.threadId,
    }),
  });
  if (!response.ok) {
    throw new Error(`ack_http_${response.status}`);
  }
}

export const hasSurfacesWorkerResponseBeenDelivered = hasSurfaceResponseBeenDelivered;
export const markSurfacesWorkerResponseDelivered = markSurfaceResponseDelivered;
export const acknowledgeSurfacesWorkerDelivery = acknowledgeSurfaceDelivery;
