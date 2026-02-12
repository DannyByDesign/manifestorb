import { redis } from "@/server/lib/redis";
import { createHash } from "node:crypto";

// Not password hashing - creating a short cache key for OAuth authorization codes
function createOAuthCodeCacheKey(code: string): string {
  return createHash("sha256").update(code).digest("hex").slice(0, 16);
}

function getCodeKey(code: string) {
  return `oauth-code:${createOAuthCodeCacheKey(code)}`;
}

interface OAuthCodeResult {
  status: "success";
  params: Record<string, string>;
}

export async function acquireOAuthCodeLock(code: string): Promise<boolean> {
  try {
    const result = await redis.set(getCodeKey(code), "processing", {
      ex: 60,
      nx: true, // Only set if key doesn't exist (atomic)
    });

    return result === "OK";
  } catch {
    // Dedupe lock is an optimization. If Redis isn't configured or is down,
    // allow the request to proceed rather than failing OAuth.
    return true;
  }
}

export async function getOAuthCodeResult(
  code: string,
): Promise<OAuthCodeResult | null> {
  let value: string | OAuthCodeResult | null = null;
  try {
    value = await redis.get<string | OAuthCodeResult>(getCodeKey(code));
  } catch {
    return null;
  }

  if (!value || value === "processing") {
    return null;
  }

  if (typeof value === "object" && value.status === "success") {
    return value;
  }

  return null;
}

export async function setOAuthCodeResult(
  code: string,
  params: Record<string, string>,
): Promise<void> {
  const result: OAuthCodeResult = {
    status: "success",
    params,
  };

  try {
    await redis.set(getCodeKey(code), result, { ex: 60 });
  } catch {
    // Best-effort cache only.
  }
}

/**
 * Clear the OAuth code from Redis.
 * Fails silently - cleanup errors should never mask the original error in catch blocks.
 */
export async function clearOAuthCode(code: string): Promise<void> {
  try {
    await redis.del(getCodeKey(code));
  } catch {
    // Silently ignore - this is called in error handlers where we don't want
    // cleanup failures to mask the original error
  }
}
