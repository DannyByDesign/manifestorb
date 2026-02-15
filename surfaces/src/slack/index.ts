import { App } from "@slack/bolt";
import type { Block, KnownBlock } from "@slack/types";
import { randomUUID } from "node:crypto";
import {
    fetchCanonicalSidecarThread,
    forwardToBrain,
    fetchSurfaceIdentity,
    fetchOnboardingLinkUrl,
    toPlainSidecarText,
    type InteractiveAction,
    type InteractivePayload,
    type SurfaceIdentityResult,
} from "../utils";
import {
    setPlatformEnabled,
    setPlatformError,
    setPlatformStarted,
    touchPlatformEvent
} from "../platform-status";
import { redis } from "../db/redis";
import { env } from "../env";

const CORE_BASE_URL = env.CORE_BASE_URL;
const SHARED_SECRET = env.SURFACES_SHARED_SECRET;
const SLACK_LEADER_LOCK_KEY = process.env.SLACK_LEADER_LOCK_KEY || "surfaces:slack:socket-mode:leader";
const SLACK_LEADER_LOCK_TTL_MS = Number(process.env.SLACK_LEADER_LOCK_TTL_MS || 30000);
const SLACK_RECONNECT_WINDOW_MS = 60_000;
const SLACK_RECONNECT_THRESHOLD = 8;
const SLACK_IDENTITY_CACHE_TTL_MS = 30_000;
const SLACK_UNLINKED_CONFIRMATION_THRESHOLD = 2;
const SLACK_UNLINKED_STREAK_TTL_MS = 5 * 60_000;
const SLACK_DELIVERY_DEDUPE_TTL_MS = Math.max(
    60_000,
    Number(process.env.SLACK_DELIVERY_DEDUPE_TTL_MS || 7 * 24 * 60 * 60 * 1000),
);
const SLACK_DELIVERY_DEDUPE_KEY_PREFIX = "surfaces:slack:delivery";
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
    botId?: string;
    appId?: string;
};

type SlackIdentityCacheEntry = {
    status: SurfaceIdentityResult["status"];
    checkedAt: number;
    reason?: string;
    userId?: string;
};

const slackThreadContext = new Map<string, string>();
const slackIdentityCache = new Map<string, SlackIdentityCacheEntry>();
const slackUnlinkedStreak = new Map<string, { count: number; updatedAt: number }>();
const slackDeliveryDedupeFallback = new Map<string, number>();

function threadContextKey(channelId: string, userId: string): string {
    return `${channelId}:${userId}`;
}

function slackDeliveryDedupeKey(responseId: string): string {
    return `${SLACK_DELIVERY_DEDUPE_KEY_PREFIX}:${responseId}`;
}

async function hasSlackResponseBeenDelivered(responseId: string): Promise<boolean> {
    if (redis) {
        try {
            const value = await redis.get(slackDeliveryDedupeKey(responseId));
            return value === "1";
        } catch (error) {
            console.warn("[Surfaces][Slack] Failed to read delivery dedupe key", {
                responseId,
                error: error instanceof Error ? error.message : String(error),
            });
        }
    }

    const expiresAt = slackDeliveryDedupeFallback.get(responseId);
    if (!expiresAt) return false;
    if (expiresAt < Date.now()) {
        slackDeliveryDedupeFallback.delete(responseId);
        return false;
    }
    return true;
}

async function markSlackResponseDelivered(responseId: string): Promise<void> {
    if (redis) {
        try {
            await redis.set(
                slackDeliveryDedupeKey(responseId),
                "1",
                "PX",
                SLACK_DELIVERY_DEDUPE_TTL_MS,
            );
            return;
        } catch (error) {
            console.warn("[Surfaces][Slack] Failed to write delivery dedupe key", {
                responseId,
                error: error instanceof Error ? error.message : String(error),
            });
        }
    }

    slackDeliveryDedupeFallback.set(responseId, Date.now() + SLACK_DELIVERY_DEDUPE_TTL_MS);
}

async function acknowledgeSlackDelivery(params: {
    responseId: string;
    providerMessageId: string;
    channelId: string;
    threadId?: string;
}) {
    const response = await fetch(`${CORE_BASE_URL}/api/surfaces/inbound/ack`, {
        method: "POST",
        headers: {
            "Content-Type": "application/json",
            "x-surfaces-secret": SHARED_SECRET,
        },
        body: JSON.stringify({
            responseId: params.responseId,
            provider: "slack",
            providerMessageId: params.providerMessageId,
            channelId: params.channelId,
            threadId: params.threadId,
        }),
    });

    if (!response.ok) {
        throw new Error(`ack_http_${response.status}`);
    }
}

function normalizeSlackThreadTs(value: unknown): string | undefined {
    return typeof value === "string" && value.length > 0 ? value : undefined;
}

function extractSlackTeamId(bodyOrContext: unknown): string | undefined {
    if (!bodyOrContext || typeof bodyOrContext !== "object") return undefined;
    const record = bodyOrContext as Record<string, unknown>;

    const direct =
        typeof record.team_id === "string"
            ? record.team_id
            : (record.team && typeof record.team === "object" && typeof (record.team as any).id === "string")
                ? (record.team as any).id
                : undefined;
    if (direct) return direct;

    // Bolt context sometimes carries teamId.
    const ctxTeamId = typeof (record as any).teamId === "string" ? (record as any).teamId : undefined;
    if (ctxTeamId) return ctxTeamId;

    // Socket mode payloads often include authorizations.
    const auths = Array.isArray((record as any).authorizations) ? (record as any).authorizations : null;
    const fromAuth = auths && auths.length > 0 && typeof auths[0]?.team_id === "string" ? auths[0].team_id : undefined;
    return fromAuth;
}

function toSlackProviderAccountId(params: { teamId?: string; userId: string }): { providerAccountId: string; providerTeamId?: string } {
    const teamId = params.teamId?.trim();
    if (teamId) {
        return { providerAccountId: `${teamId}:${params.userId}`, providerTeamId: teamId };
    }
    return { providerAccountId: params.userId };
}

function applySlackUnlinkedDebounce(
    cacheKey: string,
    identity: SurfaceIdentityResult,
): SurfaceIdentityResult {
    const now = Date.now();
    const streak = slackUnlinkedStreak.get(cacheKey);
    if (identity.status === "linked") {
        if (streak) {
            slackUnlinkedStreak.delete(cacheKey);
        }
        return identity;
    }

    if (identity.status === "unknown") {
        return identity;
    }

    const nextCount =
        streak && now - streak.updatedAt < SLACK_UNLINKED_STREAK_TTL_MS
            ? streak.count + 1
            : 1;
    slackUnlinkedStreak.set(cacheKey, { count: nextCount, updatedAt: now });

    if (nextCount < SLACK_UNLINKED_CONFIRMATION_THRESHOLD) {
        return {
            status: "unknown",
            linked: false,
            reason: "debounced_unlinked_signal",
        };
    }

    return identity;
}

async function resolveSlackIdentity(params: {
    providerAccountId: string;
    providerTeamId?: string;
}): Promise<SurfaceIdentityResult> {
    const now = Date.now();
    const cacheKey = params.providerAccountId;
    const cached = slackIdentityCache.get(cacheKey);
    if (cached && now - cached.checkedAt < SLACK_IDENTITY_CACHE_TTL_MS) {
        return applySlackUnlinkedDebounce(cacheKey, {
            status: cached.status,
            linked: cached.status === "linked",
            ...(cached.reason ? { reason: cached.reason } : {}),
            ...(cached.userId ? { userId: cached.userId } : {}),
        });
    }

    const identity = await fetchSurfaceIdentity({
        provider: "slack",
        providerAccountId: params.providerAccountId,
        providerTeamId: params.providerTeamId,
    });
    slackIdentityCache.set(cacheKey, {
        status: identity.status,
        checkedAt: now,
        ...(identity.reason ? { reason: identity.reason } : {}),
        ...(identity.userId ? { userId: identity.userId } : {}),
    });
    return applySlackUnlinkedDebounce(cacheKey, identity);
}

async function sendSlackOnboardingWelcome(params: {
    client: App["client"];
    channelId?: string;
    threadTs?: string;
    slackUserId: string;
    providerAccountId: string;
    providerTeamId?: string;
    origin: "app_home_opened" | "message";
}) {
    const linkUrl = await fetchOnboardingLinkUrl(
        "slack",
        params.providerAccountId,
        params.providerTeamId,
        {
            origin: params.origin,
            ...(params.channelId ? { channelId: params.channelId } : {}),
        },
    );

    const channelId = params.channelId ?? (await params.client.conversations.open({ users: params.slackUserId })).channel?.id;
    if (!channelId) {
        console.error("[Surfaces][Slack] Failed to open DM channel for onboarding", {
            slackUserId: params.slackUserId,
            providerAccountId: params.providerAccountId,
        });
        return;
    }

    if (!linkUrl) {
        await params.client.chat.postMessage({
            channel: channelId,
            thread_ts: normalizeSlackThreadTs(params.threadTs),
            text: toPlainSidecarText(
                `${WELCOME_MESSAGE} Something went wrong generating your link — please try messaging me again in a moment.`,
            ),
        });
        return;
    }

    const onboardingText = toPlainSidecarText(
        `${WELCOME_MESSAGE}\n\nTo get started, open this link to connect your Slack account (one-time): ${linkUrl}\n\nThen you can ask me about your calendar, email, and more.`,
    );

    await params.client.chat.postMessage({
        channel: channelId,
        thread_ts: normalizeSlackThreadTs(params.threadTs),
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
        botId: typeof record.bot_id === "string" ? record.bot_id : undefined,
        appId: typeof record.app_id === "string" ? record.app_id : undefined,
    };
}

async function clearInteractionButtons(params: { app: App; body: unknown }) {
    const { app, body } = params;
    if (!body || typeof body !== "object") return;
    const record = body as Record<string, unknown>;
    const container = (record.container && typeof record.container === "object")
        ? (record.container as Record<string, unknown>)
        : null;
    const message = (record.message && typeof record.message === "object")
        ? (record.message as Record<string, unknown>)
        : null;

    const channel =
        (record.channel && typeof record.channel === "object" && typeof (record.channel as any).id === "string")
            ? (record.channel as any).id
            : (container && typeof container.channel_id === "string")
                ? container.channel_id
                : undefined;
    const ts =
        (message && typeof message.ts === "string")
            ? message.ts
            : (container && typeof container.message_ts === "string")
                ? container.message_ts
                : undefined;

    const blocks = message?.blocks;
    if (!channel || !ts || !Array.isArray(blocks)) return;

    // Remove all action blocks so buttons disappear immediately after click.
    const nextBlocks = (blocks as unknown[]).filter((b) => {
        if (!b || typeof b !== "object") return true;
        return (b as any).type !== "actions";
    });

    try {
        await app.client.chat.update({
            channel,
            ts,
            // Slack requires a non-empty text fallback.
            text: (typeof message?.text === "string" && message.text.length > 0) ? message.text : " ",
            blocks: nextBlocks as any,
        });
    } catch (err) {
        console.warn("[Surfaces][Slack] Failed to clear interaction buttons", {
            channel,
            ts,
            error: err instanceof Error ? err.message : String(err),
        });
    }
}

async function replyToInteractionThread(params: { app: App; body: unknown; text: string }) {
    const { app, body, text } = params;
    if (!body || typeof body !== "object") return;
    const record = body as Record<string, unknown>;
    const container = (record.container && typeof record.container === "object")
        ? (record.container as Record<string, unknown>)
        : null;
    const message = (record.message && typeof record.message === "object")
        ? (record.message as Record<string, unknown>)
        : null;

    const channel =
        (record.channel && typeof record.channel === "object" && typeof (record.channel as any).id === "string")
            ? (record.channel as any).id
            : (container && typeof container.channel_id === "string")
                ? container.channel_id
                : undefined;

    // Prefer actual thread_ts if present; fall back to the original message ts.
    const thread_ts =
        (message && typeof (message as any).thread_ts === "string")
            ? (message as any).thread_ts
            : (container && typeof (container as any).thread_ts === "string")
                ? (container as any).thread_ts
                : (container && typeof (container as any).message_ts === "string")
                    ? (container as any).message_ts
                    : (message && typeof message.ts === "string")
                        ? message.ts
                        : undefined;

    if (!channel || !thread_ts) return;

    await app.client.chat.postMessage({
        channel,
        thread_ts,
        text,
    });
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
    const token = env.SLACK_BOT_TOKEN;
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
        token: env.SLACK_BOT_TOKEN,
        appToken: env.SLACK_APP_TOKEN,
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
    app.action(/approve_request|deny_request/, async ({ body, action, ack }) => {
        await ack();
        await clearInteractionButtons({ app, body });

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
                userId: toSlackProviderAccountId({
                    teamId: extractSlackTeamId(body),
                    userId: body.user.id,
                }).providerAccountId,
                provider: "slack",
            })
        });

        let responseBody: { error?: string; message?: string; decision?: string } | null = null;
        try {
            responseBody = (await response.json()) as { error?: string; message?: string; decision?: string };
        } catch {
            responseBody = null;
        }

        if (!response.ok) {
            const detail = responseBody?.message || responseBody?.error || response.statusText;
            console.error("[Surfaces][Slack] Approval action failed", {
                requestId,
                decision,
                status: response.status,
                detail,
                userId: body.user.id,
            });
            await replyToInteractionThread({
                app,
                body,
                text: `Failed to ${decision} request. ${detail}`,
            });
        }
    });

    // Handle Ambiguous Time Choices
    app.action(/ambiguous_earlier|ambiguous_later/, async ({ body, action, ack }) => {
        await ack();
        await clearInteractionButtons({ app, body });

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
            await replyToInteractionThread({
                app,
                body,
                text: `Got it — using the ${choice} time. ✅`,
            });
        } else {
            await replyToInteractionThread({
                app,
                body,
                text: `Failed to resolve that time. ${response.statusText}`,
            });
        }
    });

    // Handle Draft Send/Discard
    app.action(/draft_send|draft_discard/, async ({ body, action, ack }) => {
        await ack();
        await clearInteractionButtons({ app, body });

        if (action.type !== "button") return;

        const actionId = ("action_id" in action) ? action.action_id : undefined;
        if (!actionId) return;

        const [draftId, emailAccountId, userId] = (action.value || "").split(":");

        if (!draftId || !emailAccountId || !userId) {
            await replyToInteractionThread({ app, body, text: "Invalid draft action data." });
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
                await replyToInteractionThread({ app, body, text: "✅ Email sent successfully!" });
            } else {
                const error = await response.text();
                await replyToInteractionThread({ app, body, text: `❌ Failed to send email: ${error}` });
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
                await replyToInteractionThread({ app, body, text: "🗑️ Draft discarded." });
            } else {
                await replyToInteractionThread({ app, body, text: "Failed to discard draft." });
            }
        }
    });

    // App Home onboarding: a reliable entrypoint when users click into the app.
    app.event("app_home_opened", async ({ event, client, context }) => {
        const slackUserId = event.user;
        const teamId = extractSlackTeamId(context) ?? extractSlackTeamId(event);
        const { providerAccountId, providerTeamId } = toSlackProviderAccountId({ teamId, userId: slackUserId });
        const identity = await resolveSlackIdentity({ providerAccountId, providerTeamId });
        if (identity.status === "unknown") {
            console.warn("[Surfaces][Slack] App Home identity check unavailable; deferring onboarding", {
                providerAccountId,
                providerTeamId: providerTeamId ?? null,
                reason: identity.reason ?? "unknown",
            });
            return;
        }
        if (identity.linked) return;
        await sendSlackOnboardingWelcome({
            client,
            slackUserId,
            providerAccountId,
            providerTeamId,
            origin: "app_home_opened",
        });
    });

    // Listen for messages
    app.message(async ({ message, body, context, say }) => {
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
                botId: meta.botId ?? null,
                appId: meta.appId ?? null,
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

            // Never process bot/app-authored messages as user input.
            if (meta.botId || meta.appId) {
                console.log("[Surfaces][Slack] Skipping bot/app-authored message", {
                    channel: meta.channel,
                    user: meta.user,
                    ts: meta.ts,
                    botId: meta.botId ?? null,
                    appId: meta.appId ?? null,
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
            const slackUserId = meta.user;
            const messageTs = meta.ts;
            const messageText = meta.text;
            // Only treat 1:1 IMs as safe for onboarding links. Group DMs can contain other users.
            const isDirectMessage = meta.channelType === "im";
            const teamId = extractSlackTeamId(context) ?? extractSlackTeamId(body);
            const { providerAccountId, providerTeamId } = toSlackProviderAccountId({ teamId, userId: slackUserId });
            const cacheKey = threadContextKey(channelId, providerAccountId);
            const cachedThreadTs = slackThreadContext.get(cacheKey);
            const identity = await resolveSlackIdentity({ providerAccountId, providerTeamId });
            if (identity.status === "unknown") {
                console.warn("[Surfaces][Slack] Identity check unavailable; continuing without onboarding", {
                    providerAccountId,
                    providerTeamId: providerTeamId ?? null,
                    reason: identity.reason ?? "unknown",
                });
            } else if (!identity.linked) {
                if (isDirectMessage) {
                    await sendSlackOnboardingWelcome({
                        client: app.client,
                        channelId,
                        threadTs: meta.threadTs ?? messageTs,
                        slackUserId,
                        providerAccountId,
                        providerTeamId,
                        origin: "message",
                    });
                } else {
                    await app.client.chat.postMessage({
                        channel: channelId,
                        thread_ts: meta.threadTs ?? messageTs,
                        text: toPlainSidecarText(
                            "To connect your Amodel account, please DM me directly.",
                        ),
                    });
                }
                return;
            }
            const backendCanonicalThreadTs = await fetchCanonicalSidecarThread({
                provider: "slack",
                providerAccountId: providerAccountId,
                providerTeamId,
                channelId,
                isDirectMessage,
                incomingThreadId: meta.threadTs,
                messageId: messageTs,
            });

            const canonicalThreadTs =
                normalizeSlackThreadTs(backendCanonicalThreadTs) ??
                normalizeSlackThreadTs(inboundThreadTs) ??
                normalizeSlackThreadTs(cachedThreadTs) ??
                messageTs;

            slackThreadContext.set(cacheKey, canonicalThreadTs);
            const replyThreadTs = canonicalThreadTs;
            const statusThreadTs = normalizeSlackThreadTs(assistantThreadTs);

            console.log("[Surfaces][Slack] Resolved canonical thread", {
                channel: channelId,
                user: slackUserId,
                messageTs,
                incomingThreadTs: meta.threadTs ?? null,
                backendThreadTs: backendCanonicalThreadTs ?? null,
                inboundThreadTs: inboundThreadTs ?? null,
                cachedThreadTs: cachedThreadTs ?? null,
                resolvedThreadTs: canonicalThreadTs ?? null,
                isDirectMessage,
            });

            if (statusThreadTs) {
                await setSlackAssistantThinkingStatus({
                    app,
                    channelId,
                    threadTs: statusThreadTs,
                });
            }

            try {
                const brainResponse = await forwardToBrain({
                    provider: "slack",
                    content: messageText,
                    context: {
                        channelId,
                        userId: providerAccountId,
                        workspaceId: providerTeamId,
                        messageId: messageTs,
                        threadId: replyThreadTs,
                        isDirectMessage,
                    },
                });

                if (!brainResponse || !Array.isArray(brainResponse.responses)) {
                    console.error("[Surfaces][Slack] Brain response missing/invalid", {
                        channel: channelId,
                        user: slackUserId,
                        ts: messageTs,
                        hasResponse: Boolean(brainResponse),
                    });
                    await say({
                        thread_ts: replyThreadTs,
                        text: toPlainSidecarText(
                            "I couldn't reach the AI service just now. Please try again in a moment.",
                        ),
                    });
                    return;
                }

                if (brainResponse.responses.length === 0) {
                    console.error("[Surfaces][Slack] Brain returned zero responses", {
                        channel: channelId,
                        user: slackUserId,
                        ts: messageTs,
                    });
                    await say({
                        thread_ts: replyThreadTs,
                        text: toPlainSidecarText(
                            "I received that, but couldn't generate a reply. Please resend your request.",
                        ),
                    });
                    return;
                }

                console.log("[Surfaces][Slack] Brain responses ready", {
                    channel: channelId,
                    user: slackUserId,
                    ts: messageTs,
                    responseCount: brainResponse.responses.length,
                });

                for (const [index, resp] of brainResponse.responses.entries()) {
                    try {
                        const responseId =
                            resp && typeof resp === "object" && typeof (resp as { responseId?: unknown }).responseId === "string"
                                ? (resp as { responseId: string }).responseId
                                : undefined;
                        if (responseId && await hasSlackResponseBeenDelivered(responseId)) {
                            console.log("[Surfaces][Slack] Skipping already delivered response", {
                                channel: channelId,
                                user: slackUserId,
                                ts: messageTs,
                                responseIndex: index,
                                responseId,
                            });
                            continue;
                        }

                        // Enforce a single long-running thread per user/channel.
                        // We intentionally ignore per-response thread routing to avoid "history tab" UX issues.
                        const responseThreadTs = replyThreadTs;
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
                            if (responseId) {
                                await markSlackResponseDelivered(responseId);
                                try {
                                    await acknowledgeSlackDelivery({
                                        responseId,
                                        providerMessageId: messageTs,
                                        channelId,
                                        threadId: replyThreadTs,
                                    });
                                } catch (error) {
                                    console.warn("[Surfaces][Slack] Failed to acknowledge delivery", {
                                        responseId,
                                        channel: channelId,
                                        ts: messageTs,
                                        error: error instanceof Error ? error.message : String(error),
                                    });
                                }
                            }
                            slackThreadContext.set(cacheKey, replyThreadTs);
                            console.log("[Surfaces][Slack] Sent interactive response", {
                                channel: channelId,
                                user: slackUserId,
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
                            if (responseId) {
                                await markSlackResponseDelivered(responseId);
                                try {
                                    await acknowledgeSlackDelivery({
                                        responseId,
                                        providerMessageId: messageTs,
                                        channelId,
                                        threadId: replyThreadTs,
                                    });
                                } catch (error) {
                                    console.warn("[Surfaces][Slack] Failed to acknowledge delivery", {
                                        responseId,
                                        channel: channelId,
                                        ts: messageTs,
                                        error: error instanceof Error ? error.message : String(error),
                                    });
                                }
                            }
                            slackThreadContext.set(cacheKey, replyThreadTs);
                            console.log("[Surfaces][Slack] Sent text response", {
                                channel: channelId,
                                user: slackUserId,
                                ts: messageTs,
                                threadTs: replyThreadTs,
                                responseIndex: index,
                                contentLength: resp.content.length,
                            });
                        } else {
                            console.log("[Surfaces][Slack] Skipped empty outbound response", {
                                channel: channelId,
                                user: slackUserId,
                                ts: messageTs,
                                responseIndex: index,
                            });
                        }
                    } catch (err) {
                        console.error("[Surfaces][Slack] Failed to send response via Slack API", {
                            channel: channelId,
                            user: slackUserId,
                            ts: messageTs,
                            responseIndex: index,
                            hasInteractive: Boolean(resp?.interactive),
                            contentPreview: typeof resp?.content === "string" ? resp.content.slice(0, 120) : null,
                            error: err instanceof Error ? err.message : String(err),
                        });
                    }
                }
            } finally {
                if (statusThreadTs) {
                    await clearSlackAssistantThinkingStatus({
                        app,
                        channelId,
                        threadTs: statusThreadTs,
                    });
                }
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

export async function sendSlackMessage(
    channelId: string,
    text: string,
    _blocks?: (Block | KnownBlock)[],
    threadId?: string | null,
) {
    if (!slackApp) {
        console.error("Slack app not initialized");
        return;
    }
    try {
        await slackApp.client.chat.postMessage({
            channel: channelId,
            text: toPlainSidecarText(text),
            blocks: undefined,
            thread_ts: normalizeSlackThreadTs(threadId),
        });
    } catch (error) {
        console.error("Failed to send Slack message", error);
    }
}

/**
 * Send the onboarding welcome message to a Slack user (opens DM if needed).
 */

export async function sendLinkedToSlackUser(providerAccountId: string): Promise<{ ok: boolean; channelId?: string; error?: string }> {
    if (!slackApp) {
        return { ok: false, error: "Slack app not initialized" };
    }
    const slackUserId = providerAccountId.includes(":")
        ? providerAccountId.split(":")[providerAccountId.split(":").length - 1]
        : providerAccountId;
    try {
        const open = await slackApp.client.conversations.open({ users: slackUserId });
        const channel = open.channel?.id;
        if (!channel) {
            return { ok: false, error: "Could not open DM channel" };
        }

        const text = toPlainSidecarText(
            "Connected. You're all set.\n\nSend me a message here anytime and I'll handle email + calendar for you.",
        );

        await slackApp.client.chat.postMessage({
            channel,
            text,
            blocks: [
                { type: "section", text: { type: "plain_text", text: "Connected. You're all set." } },
                {
                    type: "section",
                    text: {
                        type: "plain_text",
                        text: "Send me a message here anytime and I'll handle email + calendar for you.",
                    },
                },
            ],
        });

        // Ensure subsequent inbound messages don't get stuck behind a stale "unlinked" cache entry.
        slackIdentityCache.set(providerAccountId, {
            status: "linked",
            checkedAt: Date.now(),
        });
        slackUnlinkedStreak.delete(providerAccountId);
        return { ok: true, channelId: channel };
    } catch (error) {
        const msg = error instanceof Error ? error.message : String(error);
        console.error("[Surfaces] sendLinkedToSlackUser failed", error);
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
        slackIdentityCache.clear();
        slackUnlinkedStreak.clear();
        slackThreadContext.clear();
        await releaseSlackLeaderLock();
    }
}
