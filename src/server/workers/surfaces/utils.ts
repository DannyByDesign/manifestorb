import { config } from "dotenv";
import { env } from "./env";
import { forwardToBrainWithTransport } from "./transport/brain-ingress";
config();

const SHARED_SECRET = env.SURFACES_SHARED_SECRET;

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

export interface SurfaceSessionResult extends SurfaceIdentityResult {
    matchedProviderAccountId?: string;
    canonicalThreadId?: string;
    canonicalChannelId?: string;
    conversationId?: string;
}

type SurfaceActionPayload =
    | {
        type: "approval";
        requestId: string;
        decision: "approve" | "deny";
        reason?: string;
    }
    | {
        type: "ambiguous_time";
        requestId: string;
        choice: "earlier" | "later";
    }
    | {
        type: "draft";
        draftId: string;
        decision: "send" | "discard";
        userId: string;
        emailAccountId: string;
    };

export type SurfaceActionResult = {
    ok: boolean;
    status: number;
    error?: string;
    body?: unknown;
};

export type BrainOutboundResponse = {
    responseId?: string;
    content?: string;
    interactive?: InteractivePayload;
    targetChannelId?: string;
    targetThreadId?: string;
    [key: string]: unknown;
};

export type BrainResponsePayload = {
    responses: BrainOutboundResponse[];
};

const CORE_BASE_URL = env.CORE_BASE_URL;

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

export async function resolveSurfaceSession(params: {
    provider: "slack" | "discord" | "telegram";
    providerAccountId: string;
    providerTeamId?: string;
    channelId: string;
    isDirectMessage?: boolean;
    incomingThreadId?: string;
    messageId: string;
}): Promise<SurfaceSessionResult> {
    try {
        const response = await fetch(`${CORE_BASE_URL}/api/surfaces/session/resolve`, {
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
                reason: `session_http_${response.status}`,
            };
        }
        const data = (await response.json()) as {
            linked?: boolean;
            status?: SurfaceIdentityStatus;
            userId?: string;
            reason?: string;
            matchedProviderAccountId?: string;
            canonicalThreadId?: string;
            canonicalChannelId?: string;
            conversationId?: string;
        };
        const status = data.status ?? (data.linked ? "linked" : "unlinked");
        return {
            status,
            linked: status === "linked",
            ...(typeof data.userId === "string" ? { userId: data.userId } : {}),
            ...(typeof data.reason === "string" ? { reason: data.reason } : {}),
            ...(typeof data.matchedProviderAccountId === "string"
                ? { matchedProviderAccountId: data.matchedProviderAccountId }
                : {}),
            ...(typeof data.canonicalThreadId === "string"
                ? { canonicalThreadId: data.canonicalThreadId }
                : {}),
            ...(typeof data.canonicalChannelId === "string"
                ? { canonicalChannelId: data.canonicalChannelId }
                : {}),
            ...(typeof data.conversationId === "string"
                ? { conversationId: data.conversationId }
                : {}),
        };
    } catch (error) {
        console.error("[Surfaces] Failed to resolve sidecar session", {
            provider: params.provider,
            error: error instanceof Error ? error.message : String(error),
        });
        return {
            status: "unknown",
            linked: false,
            reason: "session_transport_error",
        };
    }
}

export async function forwardToBrain(params: {
    provider: "slack" | "discord" | "telegram";
    content: string;
    context: Record<string, unknown>;
}) {
    const payload = await forwardToBrainWithTransport(params);
    if (
        payload &&
        typeof payload === "object" &&
        Array.isArray((payload as { responses?: unknown }).responses)
    ) {
        return payload as BrainResponsePayload;
    }

    return null;
}

export async function submitSurfaceAction(params: {
    provider: "slack" | "discord" | "telegram";
    providerAccountId: string;
    action: SurfaceActionPayload;
}): Promise<SurfaceActionResult> {
    try {
        const response = await fetch(`${CORE_BASE_URL}/api/surfaces/actions`, {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                "Authorization": `Bearer ${SHARED_SECRET}`,
            },
            body: JSON.stringify(params),
        });

        let payload: unknown = null;
        let bodyText = "";
        try {
            payload = await response.json();
        } catch {
            bodyText = await response.text().catch(() => "");
        }

        const record = payload && typeof payload === "object"
            ? (payload as Record<string, unknown>)
            : null;
        const error =
            typeof record?.error === "string"
                ? record.error
                : typeof record?.message === "string"
                    ? record.message
                    : typeof record?.detail === "string"
                        ? record.detail
                        : bodyText.length > 0
                            ? bodyText.slice(0, 500)
                            : undefined;

        return {
            ok: response.ok,
            status: response.status,
            ...(payload !== null ? { body: payload } : {}),
            ...(error ? { error } : {}),
        };
    } catch (error) {
        return {
            ok: false,
            status: 0,
            error: error instanceof Error ? error.message : String(error),
        };
    }
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
