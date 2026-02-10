import { config } from "dotenv";
import { env } from "./env";
config();

const BRAIN_API_URL = env.BRAIN_API_URL;
const SHARED_SECRET = env.SURFACES_SHARED_SECRET ?? "dev-secret";
console.log(`[Surfaces] Using Secret: ${SHARED_SECRET.substring(0, 3)}...`);

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

const CORE_BASE_URL = process.env.CORE_BASE_URL || "http://localhost:3000";

/** Fetch a one-time link URL for onboarding (Slack/Discord/Telegram). Sidecar-only. */
export async function fetchOnboardingLinkUrl(
    provider: "slack" | "discord" | "telegram",
    providerAccountId: string,
    providerTeamId?: string,
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

export async function fetchCanonicalSidecarThread(params: {
    provider: "slack" | "discord" | "telegram";
    providerAccountId: string;
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
    history?: { role: "user" | "assistant"; content: string }[];
}) {
    try {
        console.log(`[Surfaces] Forwarding to Brain (${params.provider})`, {
            channelId: params.context?.channelId,
            userId: params.context?.userId,
            messageId: params.context?.messageId,
            isDirectMessage: params.context?.isDirectMessage,
            contentLength: params.content.length,
            historyCount: params.history?.length ?? 0,
        });
        const response = await fetch(BRAIN_API_URL, {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                "Authorization": `Bearer ${SHARED_SECRET}`,
            },
            body: JSON.stringify(params),
        });

        if (!response.ok) {
            console.error(`[Surfaces] Brain Error: ${response.status} ${response.statusText}`);
            const text = await response.text();
            console.error(text);
            return null;
        }
        const json = await response.json();
        const responses = Array.isArray(json?.responses) ? json.responses.length : 0;
        console.log("[Surfaces] Brain response received", {
            provider: params.provider,
            channelId: params.context?.channelId,
            userId: params.context?.userId,
            responses,
        });
        return json;
    } catch (error) {
        console.error("[Surfaces] Network Error forwarding to Brain:", error);
        return null;
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
