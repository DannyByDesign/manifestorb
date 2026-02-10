import { App } from "@slack/bolt";
import type { Block, KnownBlock } from "@slack/types";
import {
    fetchCanonicalSidecarThread,
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

const CORE_BASE_URL = process.env.CORE_BASE_URL || "http://localhost:3000";
const SHARED_SECRET = process.env.SURFACES_SHARED_SECRET || "dev-secret";
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

const WELCOME_MESSAGE =
    "Hi! I'm your AI assistant. To use me here, link your Slack account to your Amodel profile (one-time setup).";

let assistantStatusSupported = true;
let assistantStatusWarningLogged = false;
const canonicalThreadByConversationKey = new Map<string, string>();

function getConversationKey(params: { channelId: string; userId: string }) {
    return `${params.channelId}:${params.userId}`;
}

function rememberCanonicalThread(params: {
    channelId: string;
    userId: string;
    threadTs?: string | null;
}) {
    if (!params.threadTs) return;
    canonicalThreadByConversationKey.set(getConversationKey(params), params.threadTs);
}

function resolveCanonicalThread(params: {
    channelId: string;
    userId: string;
    incomingThreadTs?: string;
    messageTs: string;
}) {
    if (params.incomingThreadTs) {
        rememberCanonicalThread({
            channelId: params.channelId,
            userId: params.userId,
            threadTs: params.incomingThreadTs,
        });
        return params.incomingThreadTs;
    }
    return (
        canonicalThreadByConversationKey.get(
            getConversationKey({ channelId: params.channelId, userId: params.userId }),
        ) || params.messageTs
    );
}

function normalizeSlackThreadTs(threadTs?: string | null): string | undefined {
    if (typeof threadTs !== "string") return undefined;
    const trimmed = threadTs.trim();
    if (!trimmed || trimmed === "root") return undefined;
    return trimmed;
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

function getInteractionThreadContext(body: unknown): {
    channelId?: string;
    threadTs?: string;
} {
    if (!body || typeof body !== "object") return {};
    const record = body as Record<string, unknown>;
    const channelObj =
        record.channel && typeof record.channel === "object"
            ? (record.channel as Record<string, unknown>)
            : undefined;
    const messageObj =
        record.message && typeof record.message === "object"
            ? (record.message as Record<string, unknown>)
            : undefined;
    const containerObj =
        record.container && typeof record.container === "object"
            ? (record.container as Record<string, unknown>)
            : undefined;
    const channelId =
        typeof channelObj?.id === "string"
            ? channelObj.id
            : undefined;
    const threadTs =
        typeof messageObj?.thread_ts === "string"
            ? messageObj.thread_ts
            : typeof messageObj?.ts === "string"
                ? messageObj.ts
                : typeof containerObj?.thread_ts === "string"
                    ? containerObj.thread_ts
                    : undefined;
    return { channelId, threadTs };
}

function getInteractionMessageContext(body: unknown): {
    channelId?: string;
    messageTs?: string;
    text?: string;
    blocks?: SlackBlock[];
} {
    if (!body || typeof body !== "object") return {};
    const record = body as Record<string, unknown>;
    const channelObj =
        record.channel && typeof record.channel === "object"
            ? (record.channel as Record<string, unknown>)
            : undefined;
    const messageObj =
        record.message && typeof record.message === "object"
            ? (record.message as Record<string, unknown>)
            : undefined;
    const channelId = typeof channelObj?.id === "string" ? channelObj.id : undefined;
    const messageTs = typeof messageObj?.ts === "string" ? messageObj.ts : undefined;
    const text = typeof messageObj?.text === "string" ? messageObj.text : undefined;
    const blocks = Array.isArray(messageObj?.blocks) ? (messageObj.blocks as SlackBlock[]) : undefined;
    return { channelId, messageTs, text, blocks };
}

async function clearInteractionButtons(params: {
    app: App;
    body: unknown;
}) {
    const { app, body } = params;
    const { channelId, messageTs, text, blocks } = getInteractionMessageContext(body);
    if (!channelId || !messageTs || !Array.isArray(blocks)) return;

    const nextBlocks = blocks.filter((block) => {
        return (block?.type as string | undefined) !== "actions";
    });

    if (nextBlocks.length === blocks.length) return;

    try {
        await app.client.chat.update({
            channel: channelId,
            ts: messageTs,
            text: toPlainSidecarText(text || "Processing request..."),
            blocks: nextBlocks as unknown as (Block | KnownBlock)[],
        });
    } catch (err) {
        console.warn("[Surfaces][Slack] Failed to clear interaction buttons", {
            channelId,
            messageTs,
            error: err instanceof Error ? err.message : String(err),
        });
    }
}

async function replyToInteractionThread(params: {
    app: App;
    body: unknown;
    text: string;
}) {
    const { app, body, text } = params;
    const { channelId, threadTs } = getInteractionThreadContext(body);
    if (!channelId) return;
    await app.client.chat.postMessage({
        channel: channelId,
        text: toPlainSidecarText(text),
        thread_ts: normalizeSlackThreadTs(threadTs),
    });
}

export async function startSlack() {
    const token = process.env.SLACK_BOT_TOKEN;
    if (!token) {
        setPlatformEnabled("slack", false);
        console.log("⚠️ Surfaces: Skipping Slack (SLACK_BOT_TOKEN missing)");
        return;
    }
    setPlatformEnabled("slack", true);

    // Initialize Slack App in Socket Mode
    const app = new App({
        token: process.env.SLACK_BOT_TOKEN,
        appToken: process.env.SLACK_APP_TOKEN,
        socketMode: true,
    });
    slackApp = app;
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
    app.message(async ({ message }) => {
        const meta = toMessageMeta(message);
        try {
            touchPlatformEvent("slack");
            console.log("[Surfaces][Slack] Incoming message event", {
                channel: meta.channel,
                user: meta.user,
                ts: meta.ts,
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
            const userId = meta.user;
            const messageTs = meta.ts;
            const messageText = meta.text;
            const isDirectMessage = meta.channelType === "im" || channelId.startsWith("D");
            const locallyResolvedThreadTs = resolveCanonicalThread({
                channelId,
                userId,
                incomingThreadTs: meta.threadTs,
                messageTs,
            });
            const backendCanonicalThreadTs = await fetchCanonicalSidecarThread({
                provider: "slack",
                providerAccountId: userId,
                channelId,
                isDirectMessage,
                incomingThreadId: meta.threadTs,
                messageId: messageTs,
            });
            const resolvedThreadTs =
                normalizeSlackThreadTs(backendCanonicalThreadTs) ??
                normalizeSlackThreadTs(locallyResolvedThreadTs) ??
                messageTs;
            rememberCanonicalThread({
                channelId,
                userId,
                threadTs: resolvedThreadTs,
            });
            const statusThreadTs = resolvedThreadTs;

            console.log("[Surfaces][Slack] Resolved canonical thread", {
                channel: channelId,
                user: userId,
                messageTs,
                incomingThreadTs: meta.threadTs ?? null,
                backendThreadTs: backendCanonicalThreadTs ?? null,
                localThreadTs: locallyResolvedThreadTs ?? null,
                resolvedThreadTs: resolvedThreadTs ?? null,
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
                let history: { role: "user" | "assistant"; content: string }[] = [];
                try {
                    const result = await app.client.conversations.replies({
                        channel: channelId,
                        ts: resolvedThreadTs,
                        limit: 30,
                    });
                    if (result.messages) {
                        history = result.messages
                            .filter((msg) => msg.ts !== messageTs)
                            .map((msg) => ({
                                role: (msg.bot_id ? "assistant" : "user") as "user" | "assistant",
                                content: msg.text || "",
                            }))
                            .filter((msg) => msg.content !== "");
                    }
                } catch (err) {
                    console.error("[Surfaces][Slack] Failed to fetch thread history", {
                        channel: channelId,
                        user: userId,
                        ts: messageTs,
                        threadTs: resolvedThreadTs,
                        error: err instanceof Error ? err.message : String(err),
                    });
                }

                const brainResponse = await forwardToBrain({
                    provider: "slack",
                    content: messageText,
                    context: {
                        channelId,
                        userId,
                        messageId: messageTs,
                        threadId: resolvedThreadTs,
                        isDirectMessage,
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
                        const responseThreadTs = normalizeSlackThreadTs(
                            typeof (resp as { targetThreadId?: unknown }).targetThreadId === "string"
                                ? ((resp as { targetThreadId?: string }).targetThreadId ?? undefined)
                                : resolvedThreadTs,
                        );
                        rememberCanonicalThread({
                            channelId,
                            userId,
                            threadTs: responseThreadTs,
                        });
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

                            await app.client.chat.postMessage({
                                channel: channelId,
                                blocks: blocks as unknown as (Block | KnownBlock)[],
                                text: plainResponseContent || plainInteractiveSummary || "I completed that request.",
                                thread_ts: responseThreadTs,
                            });
                            console.log("[Surfaces][Slack] Sent interactive response", {
                                channel: channelId,
                                user: userId,
                                ts: messageTs,
                                threadTs: responseThreadTs,
                                responseIndex: index,
                                interactiveType: interactive.type,
                                actionsCount: interactive.actions.length,
                            });
                        } else if (resp.content) {
                            await app.client.chat.postMessage({
                                channel: channelId,
                                text: plainResponseContent,
                                thread_ts: responseThreadTs,
                            });
                            console.log("[Surfaces][Slack] Sent text response", {
                                channel: channelId,
                                user: userId,
                                ts: messageTs,
                                threadTs: responseThreadTs,
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
    setPlatformStarted("slack");
    console.log("⚡️ Surfaces: Slack Socket Mode running");
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
