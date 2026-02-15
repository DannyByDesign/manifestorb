import { config } from "dotenv";
import { env } from "./env";
config();

const BRAIN_API_URL = env.BRAIN_API_URL;
const SHARED_SECRET = env.SURFACES_SHARED_SECRET;
const BRAIN_REQUEST_TIMEOUT_MS = Number(process.env.SURFACES_BRAIN_TIMEOUT_MS || 20000);
const BRAIN_MAX_ATTEMPTS = Math.max(1, Number(process.env.SURFACES_BRAIN_MAX_ATTEMPTS || 3));
const BRAIN_RETRY_BASE_MS = Math.max(100, Number(process.env.SURFACES_BRAIN_RETRY_BASE_MS || 500));

export interface InteractiveAction {
    label: string;
    style: "primary" | "danger";
    value: string;
    url?: string;
}

export interface DraftPreview {
    to: string[];
    cc?: string[];
    bcc?: string[];
    subject: string;
    body: string;
}

export interface ActionRequestContext {
    resource: "calendar" | "task";
    action: "create" | "modify" | "delete" | "reschedule";
    title?: string;
    timeRange?: string;
}

export interface InteractivePayload {
    type: "approval_request" | "draft_created" | "action_request" | "ambiguous_time";
    approvalId?: string;  // For approval_request
    draftId?: string;     // For draft_created
    emailAccountId?: string; // For draft_created - needed to identify account
    userId?: string;      // For draft_created - needed for auth
    ambiguousRequestId?: string; // For ambiguous_time
    summary: string;
    actions: InteractiveAction[];
    preview?: DraftPreview; // For draft_created - full draft content for review
    context?: ActionRequestContext; // For action_request - calendar/task context
}

export type SurfaceIdentityStatus = "linked" | "unlinked" | "unknown";

export interface SurfaceIdentityResult {
    status: SurfaceIdentityStatus;
    linked: boolean;
    userId?: string;
    reason?: string;
}

const CORE_BASE_URL = env.CORE_BASE_URL;

function sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

function shouldRetryBrainStatus(status: number): boolean {
    return status === 408 || status === 425 || status === 429 || status >= 500;
}

function backoffDelayMs(attempt: number): number {
    const exponential = BRAIN_RETRY_BASE_MS * Math.pow(2, Math.max(0, attempt - 1));
    return Math.min(5000, exponential);
}

function candidateBrainUrls(): string[] {
    const fallback = `${CORE_BASE_URL}/api/surfaces/inbound`;
    if (BRAIN_API_URL === fallback) return [BRAIN_API_URL];
    return [BRAIN_API_URL, fallback];
}

/** Fetch a one-time link URL for onboarding (Slack/Discord/Telegram). Sidecar-only. */
export async function fetchOnboardingLinkUrl(
    provider: "slack" | "discord" | "telegram",
    providerAccountId: string,
    providerTeamId?: string,
    metadata?: Record<string, unknown>,
): Promise<string | null> {
    try {
        const response = await fetch(`${CORE_BASE_URL}/api/surfaces/link-token`, {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                "Authorization": `Bearer ${SHARED_SECRET}`,
            },
            body: JSON.stringify({
                provider,
                providerAccountId,
                providerTeamId,
                metadata,
            }),
        });
        if (!response.ok) {
            console.error(`[Surfaces] link-token API error: ${response.status}`);
            return null;
        }
        const data = (await response.json()) as { linkUrl?: string };
        return data.linkUrl ?? null;
    } catch (error) {
        console.error("[Surfaces] Failed to fetch onboarding link URL", error);
        return null;
    }
}

export async function fetchSurfaceIdentity(params: {
    provider: "slack" | "discord" | "telegram";
    providerAccountId: string;
    providerTeamId?: string;
}): Promise<SurfaceIdentityResult> {
    try {
        const response = await fetch(`${CORE_BASE_URL}/api/surfaces/identity`, {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                "Authorization": `Bearer ${SHARED_SECRET}`,
            },
            body: JSON.stringify(params),
        });
        if (!response.ok) {
            return {
                status: "unknown",
                linked: false,
                reason: `identity_http_${response.status}`,
            };
        }
        const data = (await response.json()) as {
            linked?: boolean;
            userId?: string;
            status?: SurfaceIdentityStatus;
            reason?: string;
        };
        const status = data.status ?? (data.linked ? "linked" : "unlinked");
        return {
            status,
            linked: status === "linked",
            ...(data.userId ? { userId: data.userId } : {}),
            ...(typeof data.reason === "string" ? { reason: data.reason } : {}),
        };
    } catch (error) {
        console.error("[Surfaces] Failed to resolve surface identity", {
            provider: params.provider,
            error: error instanceof Error ? error.message : String(error),
        });
        return {
            status: "unknown",
            linked: false,
            reason: "identity_transport_error",
        };
    }
}

export async function fetchCanonicalSidecarThread(params: {
    provider: "slack" | "discord" | "telegram";
    providerAccountId: string;
    providerTeamId?: string;
    channelId: string;
    isDirectMessage?: boolean;
    incomingThreadId?: string;
    messageId: string;
}): Promise<string | null> {
    try {
        const response = await fetch(`${CORE_BASE_URL}/api/surfaces/context`, {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                "Authorization": `Bearer ${SHARED_SECRET}`,
            },
            body: JSON.stringify(params),
        });
        if (!response.ok) {
            return null;
        }
        const data = (await response.json()) as { canonicalThreadId?: string | null };
        return typeof data.canonicalThreadId === "string" && data.canonicalThreadId.length > 0
            ? data.canonicalThreadId
            : null;
    } catch (error) {
        console.error("[Surfaces] Failed to resolve canonical sidecar thread", {
            provider: params.provider,
            channelId: params.channelId,
            providerAccountId: params.providerAccountId,
            messageId: params.messageId,
            error: error instanceof Error ? error.message : String(error),
        });
        return null;
    }
}

export async function forwardToBrain(params: {
    provider: "slack" | "discord" | "telegram";
    content: string;
    context: Record<string, unknown>;
}) {
    const urls = candidateBrainUrls();
    let lastError: unknown = null;

    for (const url of urls) {
        for (let attempt = 1; attempt <= BRAIN_MAX_ATTEMPTS; attempt++) {
            const startedAt = Date.now();
            const controller = new AbortController();
            const timeout = setTimeout(() => controller.abort(), BRAIN_REQUEST_TIMEOUT_MS);

            try {
                console.log(`[Surfaces] Forwarding to Brain (${params.provider})`, {
                    url,
                    attempt,
                    maxAttempts: BRAIN_MAX_ATTEMPTS,
                    channelId: params.context?.channelId,
                    userId: params.context?.userId,
                    messageId: params.context?.messageId,
                    isDirectMessage: params.context?.isDirectMessage,
                    contentLength: params.content.length,
                });
                const response = await fetch(url, {
                    method: "POST",
                    headers: {
                        "Content-Type": "application/json",
                        "Authorization": `Bearer ${SHARED_SECRET}`,
                    },
                    body: JSON.stringify(params),
                    signal: controller.signal,
                });

                const latencyMs = Date.now() - startedAt;
                if (!response.ok) {
                    const bodyText = await response.text().catch(() => "");
                    console.error("[Surfaces] Brain HTTP error", {
                        url,
                        attempt,
                        maxAttempts: BRAIN_MAX_ATTEMPTS,
                        status: response.status,
                        statusText: response.statusText,
                        latencyMs,
                        bodyPreview: bodyText.slice(0, 500),
                    });

                    if (!shouldRetryBrainStatus(response.status) || attempt >= BRAIN_MAX_ATTEMPTS) {
                        break;
                    }

                    await sleep(backoffDelayMs(attempt));
                    continue;
                }

                const json = await response.json();
                const responses = Array.isArray(json?.responses) ? json.responses.length : 0;
                console.log("[Surfaces] Brain response received", {
                    provider: params.provider,
                    url,
                    attempt,
                    channelId: params.context?.channelId,
                    userId: params.context?.userId,
                    responses,
                    latencyMs,
                });
                return json;
            } catch (error) {
                const latencyMs = Date.now() - startedAt;
                const aborted = error instanceof Error && error.name === "AbortError";
                lastError = error;
                console.error("[Surfaces] Brain transport error", {
                    url,
                    attempt,
                    maxAttempts: BRAIN_MAX_ATTEMPTS,
                    latencyMs,
                    aborted,
                    error: error instanceof Error ? error.message : String(error),
                });

                if (attempt >= BRAIN_MAX_ATTEMPTS) break;
                await sleep(backoffDelayMs(attempt));
            } finally {
                clearTimeout(timeout);
            }
        }
    }

    if (lastError) {
        console.error("[Surfaces] Exhausted all Brain endpoints", {
            urls,
            error: lastError instanceof Error ? lastError.message : String(lastError),
        });
    }
    return null;
}

/**
 * Sidecar channels should render plain conversational text.
 * Strip common markdown syntax so users don't see raw formatting markers.
 */
export function toPlainSidecarText(input: string): string {
    if (!input) return "";

    let text = input.replace(/\r\n/g, "\n");
    text = text.replace(/\u00a0/g, " ");

    // Fenced/inline code
    text = text.replace(/```([\s\S]*?)```/g, "$1");
    text = text.replace(/`([^`]+)`/g, "$1");

    // Bold/italic markers
    text = text.replace(/\*\*([^*]+)\*\*/g, "$1");
    text = text.replace(/__([^_]+)__/g, "$1");
    text = text.replace(/\*([^*\n]+)\*/g, "$1");
    text = text.replace(/_([^_\n]+)_/g, "$1");
    // Remove orphan markdown markers left behind by malformed source text
    text = text.replace(/\*\*/g, "");
    text = text.replace(/__/g, "");

    // Headings/quotes/rules
    text = text.replace(/^#{1,6}\s+/gm, "");
    text = text.replace(/^>\s?/gm, "");
    text = text.replace(/^\s*---+\s*$/gm, "");

    // Markdown links -> "label (url)"
    text = text.replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g, "$1 ($2)");
    // Slack links -> "label (url)" and bare "<url>" -> "url"
    text = text.replace(/<((?:https?:\/\/)[^|>]+)\|([^>]+)>/g, "$2 ($1)");
    text = text.replace(/<((?:https?:\/\/)[^>]+)>/g, "$1");
    // Strip remaining Slack mention-like wrappers (<@U123>, <#C123|name>, <!subteam^...>)
    text = text.replace(/<([@#!][^>]+)>/g, "$1");

    // Normalize list markers while keeping readability
    text = text.replace(/^\s*[-*+]\s+/gm, "- ");

    // Cleanup whitespace
    text = text
        .split("\n")
        .map((line) => line.replace(/[ \t]+/g, " ").trimEnd())
        .join("\n")
        .replace(/\n{3,}/g, "\n\n")
        .trim();
    return text;
}
