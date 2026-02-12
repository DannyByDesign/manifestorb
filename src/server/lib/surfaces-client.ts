import { env } from "@/env";
import { createScopedLogger } from "@/server/lib/logger";

const logger = createScopedLogger("surfaces-client");

export type SurfacesOnboardingLinkedResult =
  | { ok: true; channelId?: string | null }
  | { ok: false; error?: string };

export async function sendSurfaceOnboardingLinked(params: {
  provider: "slack" | "discord" | "telegram";
  providerAccountId: string;
  providerTeamId?: string | null;
}): Promise<SurfacesOnboardingLinkedResult | null> {
  const surfacesUrl = env.SURFACES_API_URL;
  const secret = env.SURFACES_SHARED_SECRET;
  if (!surfacesUrl || !secret) {
    logger.warn("Surfaces not configured; skipping onboarding-linked push", {
      hasSurfacesUrl: Boolean(surfacesUrl),
      hasSecret: Boolean(secret),
      provider: params.provider,
    });
    return null;
  }

  try {
    const res = await fetch(`${surfacesUrl}/onboarding/linked`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${secret}`,
      },
      body: JSON.stringify(params),
    });

    if (!res.ok) {
      const text = await res.text().catch(() => "");
      logger.warn("Failed to push onboarding-linked to surfaces", {
        provider: params.provider,
        status: res.status,
        body: text.slice(0, 500),
      });
      return { ok: false, error: text.slice(0, 500) };
    }

    const json = (await res.json().catch(() => null)) as any;
    if (!json || typeof json !== "object") return { ok: true };
    const channelId =
      typeof json.channelId === "string" ? (json.channelId as string) : null;
    return { ok: true, channelId };
  } catch (error) {
    logger.warn("Error pushing onboarding-linked to surfaces", {
      provider: params.provider,
      surfacesUrl,
      error: error instanceof Error ? error.message : String(error),
      cause:
        error instanceof Error && error.cause
          ? String(error.cause)
          : undefined,
    });
    return { ok: false, error: error instanceof Error ? error.message : String(error) };
  }
}
