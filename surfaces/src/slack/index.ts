import { App } from "@slack/bolt";
import type { Block, KnownBlock } from "@slack/types";
import { randomUUID } from "node:crypto";
import {
    forwardToBrain,
    fetchOnboardingLinkUrl,
    toPlainSidecarText,
    type InteractiveAction,
    type InteractivePayload
} from "../utils";
import {
    setPlatformEnabled,
    setPlatformError,
    setPlatformStarted,
    touchPlatformEvent
} from "../platform-status";
import { redis } from "../db/redis";

const CORE_BASE_URL = process.env.CORE_BASE_URL || "http://localhost:3000";
const SHARED_SECRET = process.env.SURFACES_SHARED_SECRET || "dev-secret";
const SLACK_LEADER_LOCK_KEY = process.env.SLACK_LEADER_LOCK_KEY || "surfaces:slack:socket-mode:leader";
const SLACK_LEADER_LOCK_TTL_MS = Number(process.env.SLACK_LEADER_LOCK_TTL_MS || 30000);
const SLACK_RECONNECT_WINDOW_MS = 60_000;
const SLACK_RECONNECT_THRESHOLD = 8;
type SlackBlock = Record<string, unknown>;
type SlackButtonElement = Record<string, unknown>;

type MessageMeta = {
    channel?: string;
    user?: string;
    ts?: string;
    threadTs?: string;
    subtype?: string;
    channelType?: string;
    text?: string;
};

const slackThreadContext = new Map<string, string>();

function threadContextKey(channelId: string, userId: string): string {
    return `${channelId}:${userId}`;
}

function toMessageMeta(message: unknown): MessageMeta {
    if (!message || typeof message !== "object") return {};
    const record = message as Record<string, unknown>;
    return {
        channel: typeof record.channel === "string" ? record.channel : undefined,
        user: typeof record.user === "string" ? record.user : undefined,
        ts: typeof record.ts === "string" ? record.ts : undefined,
        threadTs: typeof record.thread_ts === "string" ? record.thread_ts : undefined,
        subtype: typeof record.subtype === "string" ? record.subtype : undefined,
        channelType: typeof record.channel_type === "string" ? record.channel_type : undefined,
        text: typeof record.text === "string" ? record.text : undefined,
    };
}

function extractAssistantThreadTs(body: unknown): string | undefined {
    if (!body || typeof body !== "object") return undefined;
    const record = body as Record<string, unknown>;
    const candidateRecords: Array<Record<string, unknown>> = [record];
    if (record.event && typeof record.event === "object") {
        candidateRecords.push(record.event as Record<string, unknown>);
    }
    if (record.message && typeof record.message === "object") {
        candidateRecords.push(record.message as Record<string, unknown>);
    }
    for (const candidate of candidateRecords) {
        const assistantThread = candidate.assistant_thread;
        if (assistantThread && typeof assistantThread === "object") {
            const threadRecord = assistantThread as Record<string, unknown>;
            if (typeof threadRecord.thread_ts === "string") return threadRecord.thread_ts;
            if (typeof threadRecord.ts === "string") return threadRecord.ts;
        }
        if (typeof candidate.thread_ts === "string") {
            return candidate.thread_ts;
        }
    }
    return undefined;
}

const WELCOME_MESSAGE =
    "Hi! I'm your AI assistant. To use me here, link your Slack account to your Amodel profile (one-time setup).";

let assistantStatusSupported = true;
let assistantStatusWarningLogged = false;
let slackStartPromise: Promise<void> | null = null;
let slackStarted = false;
let slackLeaderToken: string | null = null;
let slackLeaderHeartbeat: ReturnType<typeof setInterval> | null = null;
let slackLeaderRetryTimer: ReturnType<typeof setTimeout> | null = null;
let reconnectTimestamps: number[] = [];

function getSocketModeClient(app: App): {
    on?: (event: string, handler: (...args: unknown[]) => void) => void;
} | null {
    const maybeReceiver = (app as unknown as { receiver?: unknown }).receiver;
    if (!maybeReceiver || typeof maybeReceiver !== "object") return null;
    const maybeClient = (maybeReceiver as { client?: unknown }).client;
    if (!maybeClient || typeof maybeClient !== "object") return null;
    const onFn = (maybeClient as { on?: unknown }).on;
    if (typeof onFn !== "function") return null;
    return maybeClient as { on: (event: string, handler: (...args: unknown[]) => void) => void };
}

function registerSocketModeDiagnostics(app: App) {
    const client = getSocketModeClient(app);
    if (!client?.on) return;

    client.on("connected", () => {
        reconnectTimestamps = [];
        setPlatformStarted("slack");
        console.log("[Surfaces][Slack] Socket Mode connected");
    });

    client.on("reconnecting", () => {
        const now = Date.now();
        reconnectTimestamps.push(now);
        reconnectTimestamps = reconnectTimestamps.filter((ts) => now - ts <= SLACK_RECONNECT_WINDOW_MS);
        const reconnects = reconnectTimestamps.length;
        console.warn("[Surfaces][Slack] Socket Mode reconnecting", { reconnectsInLastMinute: reconnects });
        if (reconnects >= SLACK_RECONNECT_THRESHOLD) {
            setPlatformError(
                "slack",
                `Socket Mode reconnect storm (${reconnects} reconnects in ${SLACK_RECONNECT_WINDOW_MS / 1000}s)`,
            );
        }
    });

    client.on("error", (error: unknown) => {
        const message = error instanceof Error ? error.message : String(error);
        setPlatformError("slack", message);
        console.error("[Surfaces][Slack] Socket Mode client error", { error: message });
    });
}

async function acquireSlackLeaderLock(): Promise<boolean> {
    if (!redis) return true;
    const token = `${process.pid}:${randomUUID()}`;
    const lock = await redis.set(
        SLACK_LEADER_LOCK_KEY,
        token,
        "PX",
        SLACK_LEADER_LOCK_TTL_MS,
        "NX",
    );
    if (lock !== "OK") {
        const holder = await redis.get(SLACK_LEADER_LOCK_KEY);
        setPlatformError("slack", "Slack leader lock held by another instance");
        console.warn("[Surfaces][Slack] Leader lock not acquired, skipping Slack start", {
            lockKey: SLACK_LEADER_LOCK_KEY,
            lockHolder: holder,
        });
        scheduleSlackLeaderRetry();
        return false;
    }

    slackLeaderToken = token;
    const heartbeatMs = Math.max(5_000, Math.floor(SLACK_LEADER_LOCK_TTL_MS / 3));
    slackLeaderHeartbeat = setInterval(async () => {
        if (!redis || !slackLeaderToken) return;
        try {
            const renewed = await redis.eval(
                `
                if redis.call("get", KEYS[1]) == ARGV[1] then
                    return redis.call("pexpire", KEYS[1], ARGV[2])
                else
                    return 0
                end
                `,
                1,
                SLACK_LEADER_LOCK_KEY,
                slackLeaderToken,
                String(SLACK_LEADER_LOCK_TTL_MS),
            );
            if (Number(renewed) !== 1) {
                setPlatformError("slack", "Lost Slack leader lock");
                console.error("[Surfaces][Slack] Lost leader lock heartbeat");
            }
        } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            setPlatformError("slack", `Leader lock heartbeat failed: ${message}`);
            console.error("[Surfaces][Slack] Leader lock heartbeat error", { error: message });
        }
    }, heartbeatMs);

    return true;
}

function scheduleSlackLeaderRetry() {
    if (slackLeaderRetryTimer) return;
    const retryMs = Math.max(5_000, Math.floor(SLACK_LEADER_LOCK_TTL_MS / 2));
    slackLeaderRetryTimer = setTimeout(() => {
        slackLeaderRetryTimer = null;
        void startSlack().catch((error) => {
            const message = error instanceof Error ? error.message : String(error);
            setPlatformError("slack", `Slack restart retry failed: ${message}`);
            console.error("[Surfaces][Slack] Failed retrying Slack startup", { error: message });
        });
    }, retryMs);
}

async function releaseSlackLeaderLock() {
    if (slackLeaderRetryTimer) {
        clearTimeout(slackLeaderRetryTimer);
        slackLeaderRetryTimer = null;
    }
    if (slackLeaderHeartbeat) {
        clearInterval(slackLeaderHeartbeat);
        slackLeaderHeartbeat = null;
    }
    if (!redis || !slackLeaderToken) return;
    try {
        await redis.eval(
            `
            if redis.call("get", KEYS[1]) == ARGV[1] then
                return redis.call("del", KEYS[1])
            else
                return 0
            end
            `,
            1,
            SLACK_LEADER_LOCK_KEY,
            slackLeaderToken,
        );
    } finally {
        slackLeaderToken = null;
    }
}

async function setSlackAssistantThreadStatus(params: {
    app: App;
    channelId: string;
    threadTs: string;
    status: string;
}) {
    if (!assistantStatusSupported) return;

    const { app, channelId, threadTs, status } = params;
    try {
        await app.client.assistant.threads.setStatus({
            channel_id: channelId,
            thread_ts: threadTs,
            status,
        });
    } catch (err) {
        const errorData =
            err && typeof err === "object" && "data" in err
                ? (err as { data?: { error?: string; needed?: string; provided?: string } }).data
                : undefined;
        const errorCode = errorData?.error;
        if (
            errorCode === "missing_scope" ||
            errorCode === "not_allowed_token_type" ||
            errorCode === "invalid_arguments" ||
            errorCode === "invalid_auth"
        ) {
            assistantStatusSupported = false;
        }

        if (!assistantStatusWarningLogged) {
            assistantStatusWarningLogged = true;
            console.warn("[Surfaces][Slack] Assistant typing status unavailable", {
                channelId,
                threadTs,
                error: err instanceof Error ? err.message : String(err),
                errorCode: errorCode ?? null,
                neededScope: errorData?.needed ?? null,
                providedScopes: errorData?.provided ?? null,
            });
        }
    }
}

async function setSlackAssistantThinkingStatus(params: {
    app: App;
    channelId: string;
    threadTs: string;
}) {
    await setSlackAssistantThreadStatus({ ...params, status: "is thinking..." });
}

async function clearSlackAssistantThinkingStatus(params: {
    app: App;
    channelId: string;
    threadTs: string;
}) {
    await setSlackAssistantThreadStatus({ ...params, status: "" });
}

async function resolvePersistedSlackThreadTs(params: {
    providerAccountId: string;
    channelId: string;
}): Promise<string | undefined> {
    try {
        const response = await fetch(`${CORE_BASE_URL}/api/surfaces/thread-context`, {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                "x-surfaces-secret": SHARED_SECRET,
            },
            body: JSON.stringify({
                provider: "slack",
                providerAccountId: params.providerAccountId,
                channelId: params.channelId,
            }),
        });
        if (!response.ok) return undefined;
        const body = (await response.json()) as { threadId?: string | null };
        return typeof body.threadId === "string" && body.threadId.length > 0
            ? body.threadId
            : undefined;
    } catch {
        return undefined;
    }
}

export async function startSlack() {
    if (slackStarted) {
        console.log("[Surfaces][Slack] start requested while already running");
        return;
    }
    if (slackStartPromise) {
        return slackStartPromise;
    }

    slackStartPromise = (async () => {
    const token = process.env.SLACK_BOT_TOKEN;
    if (!token) {
        setPlatformEnabled("slack", false);
        console.log("⚠️ Surfaces: Skipping Slack (SLACK_BOT_TOKEN missing)");
        return;
    }
    setPlatformEnabled("slack", true);
    const lockAcquired = await acquireSlackLeaderLock();
    if (!lockAcquired) return;

    // Initialize Slack App in Socket Mode
    const app = new App({
        token: process.env.SLACK_BOT_TOKEN,
        appToken: process.env.SLACK_APP_TOKEN,
        socketMode: true,
    });
    slackApp = app;
    registerSocketModeDiagnostics(app);
    app.error(async (error) => {
        const msg = error instanceof Error ? error.message : String(error);
        setPlatformError("slack", msg);
        console.error("[Surfaces][Slack] Bolt app error", { error: msg });
    });

    // Handle Approvals
    app.action(/approve_request|deny_request/, async ({ body, action, ack, say }) => {
        await ack();

        if (action.type !== "button") return;

        const actionId = ("action_id" in action) ? action.action_id : undefined;
        if (!actionId) return;
        const requestId = action.value;
        const decision = actionId === "approve_request" ? "approve" : "deny";

        console.log(`[Surfaces] Processing ${decision} for request ${requestId}`);

        const response = await fetch(`${CORE_BASE_URL}/api/approvals/${requestId}/${decision}`, {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                "x-surfaces-secret": SHARED_SECRET,
            },
            body: JSON.stringify({
                userId: body.user.id,
                provider: "slack",
            })
        });

        let responseBody: { error?: string; message?: string; decision?: string } | null = null;
        try {
            responseBody = (await response.json()) as { error?: string; message?: string; decision?: string };
        } catch {
            responseBody = null;
        }

        if (response.ok) {
            await say?.("success");
        } else {
            const detail = responseBody?.message || responseBody?.error || response.statusText;
            console.error("[Surfaces][Slack] Approval action failed", {
                requestId,
                decision,
                status: response.status,
                detail,
                userId: body.user.id,
            });
            await say?.(toPlainSidecarText(`Failed to ${decision} request. ${detail}`));
        }
    });

    // Handle Ambiguous Time Choices
    app.action(/ambiguous_earlier|ambiguous_later/, async ({ action, ack, say }) => {
        await ack();

        if (action.type !== "button") return;
        const actionId = ("action_id" in action) ? action.action_id : undefined;
        if (!actionId) return;
        const requestId = action.value;
        const choice = actionId === "ambiguous_earlier" ? "earlier" : "later";

        const response = await fetch(`${CORE_BASE_URL}/api/ambiguous-time/${requestId}/resolve`, {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                "x-surfaces-secret": SHARED_SECRET,
            },
            body: JSON.stringify({ choice })
        });

        if (response.ok) {
            await say?.(toPlainSidecarText(`Got it — using the ${choice} time. ✅`));
        } else {
            await say?.(toPlainSidecarText(`Failed to resolve that time. ${response.statusText}`));
        }
    });

    // Handle Draft Send/Discard
    app.action(/draft_send|draft_discard/, async ({ action, ack, say }) => {
        await ack();

        if (action.type !== "button") return;

        const actionId = ("action_id" in action) ? action.action_id : undefined;
        if (!actionId) return;

        const [draftId, emailAccountId, userId] = (action.value || "").split(":");

        if (!draftId || !emailAccountId || !userId) {
            await say?.(toPlainSidecarText("Invalid draft action data."));
            return;
        }

        if (actionId === "draft_send") {
            console.log(`[Surfaces] Sending draft ${draftId}`);

            const response = await fetch(`${CORE_BASE_URL}/api/drafts/${draftId}/send`, {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                    "x-surfaces-secret": SHARED_SECRET,
                },
                body: JSON.stringify({ userId, emailAccountId })
            });

            if (response.ok) {
                await say?.(toPlainSidecarText("✅ Email sent successfully!"));
            } else {
                const error = await response.text();
                await say?.(toPlainSidecarText(`❌ Failed to send email: ${error}`));
            }
        } else if (actionId === "draft_discard") {
            console.log(`[Surfaces] Discarding draft ${draftId}`);

            const response = await fetch(`${CORE_BASE_URL}/api/drafts/${draftId}?userId=${userId}&emailAccountId=${emailAccountId}`, {
                method: "DELETE",
                headers: {
                    "x-surfaces-secret": SHARED_SECRET,
                }
            });

            if (response.ok) {
                await say?.(toPlainSidecarText("🗑️ Draft discarded."));
            } else {
                await say?.(toPlainSidecarText("Failed to discard draft."));
            }
        }
    });

    // Proactive onboarding: when a user opens a DM with the bot
    app.event("im_open", async ({ event, client }) => {
        const channel = event.channel;
        const userId = event.user;
        console.log(`[Surfaces] im_open: user ${userId} opened DM (channel ${channel})`);
        const linkUrl = await fetchOnboardingLinkUrl("slack", userId);
        if (!linkUrl) {
            await client.chat.postMessage({
                channel,
                text: toPlainSidecarText(
                    `${WELCOME_MESSAGE} Something went wrong generating your link — please try messaging me again in a moment.`,
                ),
            });
            return;
        }
        const onboardingText = toPlainSidecarText(
            `${WELCOME_MESSAGE}\n\nTo get started, open this link to connect your Slack account (one-time): ${linkUrl}\n\nThen you can ask me about your calendar, email, and more.`,
        );
        await client.chat.postMessage({
            channel,
            text: onboardingText,
            blocks: [
                {
                    type: "section",
                    text: { type: "plain_text", text: WELCOME_MESSAGE },
                },
                {
                    type: "section",
                    text: {
                        type: "plain_text",
                        text: `To get started, open this link to connect your Slack account (one-time): ${linkUrl}`,
                    },
                },
                {
                    type: "section",
                    text: {
                        type: "plain_text",
                        text: "Then you can ask me about your calendar, email, and more.",
                    },
                },
                {
                    type: "actions",
                    elements: [
                        {
                            type: "button",
                            text: { type: "plain_text", text: "Link your account" },
                            url: linkUrl,
                            action_id: "onboarding_link",
                        },
                    ],
                },
            ],
        });
    });

    // Listen for messages
    app.message(async ({ message, say, body }) => {
        const meta = toMessageMeta(message);
        const assistantThreadTs = extractAssistantThreadTs(body);
        const inboundThreadTs = assistantThreadTs ?? meta.threadTs;
        try {
            touchPlatformEvent("slack");
            console.log("[Surfaces][Slack] Incoming message event", {
                channel: meta.channel,
                user: meta.user,
                ts: meta.ts,
                threadTs: meta.threadTs ?? null,
                assistantThreadTs: assistantThreadTs ?? null,
                subtype: meta.subtype ?? null,
                channelType: meta.channelType,
                hasText: Boolean(meta.text),
                textLength: meta.text?.length ?? 0,
            });

            if (meta.subtype && meta.subtype !== "file_share") {
                console.log("[Surfaces][Slack] Skipping message due to subtype filter", {
                    subtype: meta.subtype,
                    channel: meta.channel,
                    user: meta.user,
                    ts: meta.ts,
                });
                return;
            }

            if (!meta.channel || !meta.user || !meta.ts || !meta.text) {
                console.log("[Surfaces][Slack] Skipping message missing required fields", {
                    channel: meta.channel ?? null,
                    user: meta.user ?? null,
                    ts: meta.ts ?? null,
                    hasText: Boolean(meta.text),
                });
                return;
            }

            const channelId = meta.channel;
            const userId = meta.user;
            const messageTs = meta.ts;
            const messageText = meta.text;
            const cacheKey = threadContextKey(channelId, userId);
            const cachedThreadTs = slackThreadContext.get(cacheKey);
            const persistedThreadTs =
                !inboundThreadTs && !cachedThreadTs
                    ? await resolvePersistedSlackThreadTs({
                        providerAccountId: userId,
                        channelId,
                    })
                    : undefined;
            const resolvedThreadTs = inboundThreadTs || cachedThreadTs || persistedThreadTs;
            const replyThreadTs = resolvedThreadTs || messageTs;
            if (resolvedThreadTs) {
                slackThreadContext.set(cacheKey, resolvedThreadTs);
            }
            const statusThreadTs = resolvedThreadTs || messageTs;

            console.log("[Surfaces][Slack] Thread context resolution", {
                channel: channelId,
                user: userId,
                ts: messageTs,
                inboundThreadTs: inboundThreadTs ?? null,
                cachedThreadTs: cachedThreadTs ?? null,
                persistedThreadTs: persistedThreadTs ?? null,
                resolvedThreadTs: resolvedThreadTs ?? null,
            });

            await setSlackAssistantThinkingStatus({
                app,
                channelId,
                threadTs: statusThreadTs,
            });

            try {
                let history: { role: "user" | "assistant"; content: string }[] = [];
                try {
                    const result = resolvedThreadTs
                        ? await app.client.conversations.replies({
                            channel: channelId,
                            ts: resolvedThreadTs,
                            limit: 30,
                            latest: messageTs,
                            inclusive: false,
                        })
                        : await app.client.conversations.history({
                            channel: channelId,
                            limit: 30,
                            latest: messageTs,
                            inclusive: false,
                        });

                    if (result.messages) {
                        history = result.messages
                            .reverse()
                            .map((msg) => ({
                                role: (msg.bot_id ? "assistant" : "user") as "user" | "assistant",
                                content: msg.text || "",
                            }))
                            .filter((msg) => msg.content !== "");
                    }
                } catch (err) {
                    console.error("[Surfaces][Slack] Failed to fetch history", {
                        channel: channelId,
                        user: userId,
                        ts: messageTs,
                        error: err instanceof Error ? err.message : String(err),
                    });
                }

                const brainResponse = await forwardToBrain({
                    provider: "slack",
                    content: messageText,
                    context: {
                        channelId,
                        userId,
                        threadId: replyThreadTs,
                        messageId: messageTs,
                        isDirectMessage: meta.channelType === "im",
                    },
                    history,
                });

                if (!brainResponse || !Array.isArray(brainResponse.responses)) {
                    console.error("[Surfaces][Slack] Brain response missing/invalid", {
                        channel: channelId,
                        user: userId,
                        ts: messageTs,
                        hasResponse: Boolean(brainResponse),
                    });
                    return;
                }

                console.log("[Surfaces][Slack] Brain responses ready", {
                    channel: channelId,
                    user: userId,
                    ts: messageTs,
                    responseCount: brainResponse.responses.length,
                });

                for (const [index, resp] of brainResponse.responses.entries()) {
                    try {
                        const plainResponseContent = toPlainSidecarText(
                            typeof resp.content === "string" ? resp.content : "",
                        );
                        if (resp.interactive) {
                            const interactive = resp.interactive as InteractivePayload;
                            const plainInteractiveSummary = toPlainSidecarText(interactive.summary || "");
                            let buttonElements: SlackButtonElement[];

                            const isDraft = interactive.type === "draft_created";
                            const isApprovalLike =
                                interactive.type === "approval_request" ||
                                interactive.type === "action_request" ||
                                interactive.type === "ambiguous_time";

                            if (isDraft) {
                                const buttonValue = `${interactive.draftId}:${interactive.emailAccountId}:${interactive.userId}`;
                                buttonElements = interactive.actions.map((action: InteractiveAction) => {
                                    if (action.url) {
                                        return {
                                            type: "button",
                                            text: { type: "plain_text", text: action.label },
                                            url: action.url,
                                        };
                                    }
                                    return {
                                        type: "button",
                                        text: { type: "plain_text", text: action.label },
                                        style: action.style === "danger" ? "danger" : "primary",
                                        value: buttonValue,
                                        action_id: `draft_${action.value}`,
                                    };
                                });
                            } else if (isApprovalLike) {
                                buttonElements = interactive.actions.map((action: InteractiveAction) => {
                                    if (interactive.type === "ambiguous_time") {
                                        return {
                                            type: "button",
                                            text: { type: "plain_text", text: action.label },
                                            style: "primary",
                                            value: interactive.ambiguousRequestId,
                                            action_id: `ambiguous_${action.value}`,
                                        };
                                    }
                                    return {
                                        type: "button",
                                        text: { type: "plain_text", text: action.label },
                                        style: action.style === "danger" ? "danger" : "primary",
                                        value: interactive.approvalId,
                                        action_id: `${action.value}_request`,
                                    };
                                });
                            } else {
                                buttonElements = [];
                            }

                            let blocks: SlackBlock[];
                            if (isDraft && interactive.preview) {
                                const preview = interactive.preview;
                                const previewBody = toPlainSidecarText(preview.body || "");
                                const bodySnippet =
                                    previewBody.length > 500 ? `${previewBody.slice(0, 500)}...` : previewBody;

                                blocks = [
                                    {
                                        type: "header",
                                        text: { type: "plain_text", text: "Draft Email", emoji: true },
                                    },
                                    {
                                        type: "section",
                                        fields: [
                                            { type: "plain_text", text: `To:\n${preview.to.join(", ")}` },
                                            { type: "plain_text", text: `Subject:\n${preview.subject || "(no subject)"}` },
                                        ],
                                    },
                                ];

                                if (preview.cc && preview.cc.length > 0) {
                                    blocks.push({
                                        type: "section",
                                        text: { type: "plain_text", text: `CC: ${preview.cc.join(", ")}` },
                                    });
                                }

                                blocks.push(
                                    { type: "divider" },
                                    {
                                        type: "section",
                                        text: { type: "plain_text", text: bodySnippet || "(empty body)" },
                                    },
                                    { type: "divider" },
                                    {
                                        type: "actions",
                                        elements: buttonElements,
                                    }
                                );
                            } else {
                                blocks = [
                                    {
                                        type: "section",
                                        text: {
                                            type: "plain_text",
                                            text: [plainInteractiveSummary, plainResponseContent]
                                                .filter((part) => part.length > 0)
                                                .join("\n"),
                                        },
                                    },
                                    {
                                        type: "actions",
                                        elements: buttonElements,
                                    },
                                ];
                            }

                            await say({
                                thread_ts: replyThreadTs,
                                blocks: blocks as unknown as (Block | KnownBlock)[],
                                text:
                                    plainResponseContent ||
                                    plainInteractiveSummary ||
                                    "I completed that request.",
                            });
                            slackThreadContext.set(cacheKey, replyThreadTs);
                            console.log("[Surfaces][Slack] Sent interactive response", {
                                channel: channelId,
                                user: userId,
                                ts: messageTs,
                                threadTs: replyThreadTs,
                                responseIndex: index,
                                interactiveType: interactive.type,
                                actionsCount: interactive.actions.length,
                            });
                        } else if (resp.content) {
                            await say({
                                thread_ts: replyThreadTs,
                                text: plainResponseContent,
                            });
                            slackThreadContext.set(cacheKey, replyThreadTs);
                            console.log("[Surfaces][Slack] Sent text response", {
                                channel: channelId,
                                user: userId,
                                ts: messageTs,
                                threadTs: replyThreadTs,
                                responseIndex: index,
                                contentLength: resp.content.length,
                            });
                        } else {
                            console.log("[Surfaces][Slack] Skipped empty outbound response", {
                                channel: channelId,
                                user: userId,
                                ts: messageTs,
                                responseIndex: index,
                            });
                        }
                    } catch (err) {
                        console.error("[Surfaces][Slack] Failed to send response via Slack API", {
                            channel: channelId,
                            user: userId,
                            ts: messageTs,
                            responseIndex: index,
                            hasInteractive: Boolean(resp?.interactive),
                            contentPreview: typeof resp?.content === "string" ? resp.content.slice(0, 120) : null,
                            error: err instanceof Error ? err.message : String(err),
                        });
                    }
                }
            } finally {
                await clearSlackAssistantThinkingStatus({
                    app,
                    channelId,
                    threadTs: statusThreadTs,
                });
            }
        } catch (err) {
            console.error("[Surfaces][Slack] Unhandled error in message pipeline", {
                channel: meta.channel,
                user: meta.user,
                ts: meta.ts,
                subtype: meta.subtype ?? null,
                error: err instanceof Error ? err.message : String(err),
            });
        }
    });

    await app.start();
    slackStarted = true;
    setPlatformStarted("slack");
    console.log("⚡️ Surfaces: Slack Socket Mode running");
    })()
        .catch(async (error) => {
            await releaseSlackLeaderLock();
            slackStarted = false;
            slackApp = undefined;
            throw error;
        })
        .finally(() => {
            if (!slackStarted) slackStartPromise = null;
        });

    return slackStartPromise;
}

export async function sendSlackMessage(channelId: string, text: string, _blocks?: (Block | KnownBlock)[]) {
    if (!slackApp) {
        console.error("Slack app not initialized");
        return;
    }
    try {
        await slackApp.client.chat.postMessage({
            channel: channelId,
            text: toPlainSidecarText(text),
            blocks: undefined
        });
    } catch (error) {
        console.error("Failed to send Slack message", error);
    }
}

/**
 * Send the onboarding welcome message to a Slack user (opens DM if needed).
 * Used by POST /send-welcome so you can trigger the welcome to your account.
 */
export async function sendWelcomeToSlackUser(slackUserId: string): Promise<{ ok: boolean; error?: string }> {
    if (!slackApp) {
        return { ok: false, error: "Slack app not initialized" };
    }
    try {
        const open = await slackApp.client.conversations.open({ users: slackUserId });
        const channel = open.channel?.id;
        if (!channel) {
            return { ok: false, error: "Could not open DM channel" };
        }
        const linkUrl = await fetchOnboardingLinkUrl("slack", slackUserId);
        if (!linkUrl) {
            await slackApp.client.chat.postMessage({
                channel,
                text: toPlainSidecarText(
                    `${WELCOME_MESSAGE} Something went wrong generating your link — please try again in a moment.`,
                ),
            });
            return { ok: true };
        }
        const onboardingText = toPlainSidecarText(
            `${WELCOME_MESSAGE}\n\nTo get started, open this link to connect your Slack account (one-time): ${linkUrl}\n\nThen you can ask me about your calendar, email, and more.`,
        );
        await slackApp.client.chat.postMessage({
            channel,
            text: onboardingText,
            blocks: [
                { type: "section", text: { type: "plain_text", text: WELCOME_MESSAGE } },
                {
                    type: "section",
                    text: {
                        type: "plain_text",
                        text: `To get started, open this link to connect your Slack account (one-time): ${linkUrl}`,
                    },
                },
                {
                    type: "section",
                    text: {
                        type: "plain_text",
                        text: "Then you can ask me about your calendar, email, and more.",
                    },
                },
                {
                    type: "actions",
                    elements: [
                        { type: "button", text: { type: "plain_text", text: "Link your account" }, url: linkUrl, action_id: "onboarding_link" },
                    ],
                },
            ],
        });
        return { ok: true };
    } catch (error) {
        const msg = error instanceof Error ? error.message : String(error);
        console.error("[Surfaces] sendWelcomeToSlackUser failed", error);
        return { ok: false, error: msg };
    }
}

let slackApp: App | undefined;

export async function stopSlack() {
    if (!slackApp) {
        await releaseSlackLeaderLock();
        slackStarted = false;
        slackStartPromise = null;
        return;
    }
    try {
        await slackApp.stop();
    } catch (error) {
        console.error("[Surfaces][Slack] Failed to stop app cleanly", { error });
    } finally {
        slackApp = undefined;
        slackStarted = false;
        slackStartPromise = null;
        reconnectTimestamps = [];
        await releaseSlackLeaderLock();
    }
}
