
import { App } from "@slack/bolt";
import type { Block, KnownBlock } from "@slack/types";
import { forwardToBrain, fetchOnboardingLinkUrl, type InteractiveAction, type InteractivePayload } from "../utils";
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
    subtype?: string;
    channelType?: string;
    text?: string;
};

function toMessageMeta(message: unknown): MessageMeta {
    if (!message || typeof message !== "object") return {};
    const record = message as Record<string, unknown>;
    return {
        channel: typeof record.channel === "string" ? record.channel : undefined,
        user: typeof record.user === "string" ? record.user : undefined,
        ts: typeof record.ts === "string" ? record.ts : undefined,
        subtype: typeof record.subtype === "string" ? record.subtype : undefined,
        channelType: typeof record.channel_type === "string" ? record.channel_type : undefined,
        text: typeof record.text === "string" ? record.text : undefined,
    };
}

const WELCOME_MESSAGE =
    "Hi! I'm your AI assistant. To use me here, link your Slack account to your Amodel profile (one-time setup).";

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
    app.action(/approve_request|deny_request/, async ({ body, action, ack, say }) => {
        await ack();

        // Type guard for buttons
        if (action.type !== 'button') return;

        // "action_id" property check
        const actionId = ("action_id" in action) ? action.action_id : undefined;
        if (!actionId) return;
        const requestId = action.value; // The approval request ID stored in the button value
        const decision = actionId === "approve_request" ? "approve" : "deny";

        console.log(`[Surfaces] Processing ${decision} for request ${requestId}`);

        // Call Brain API
        const response = await fetch(`${CORE_BASE_URL}/api/approvals/${requestId}/${decision}`, {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                "x-surfaces-secret": SHARED_SECRET,
            },
            body: JSON.stringify({
                userId: body.user.id, // Who clicked the button
            })
        });

        if (response.ok) {
            // Update the message to remove buttons and show status
            // We rely on Slack's "replace original" behavior or post a new message
            // Ideally, we'd update the original block. For now, let's post a confirmation.
            await say?.(`Request ${decision}d! ✅`);
        } else {
            await say?.(`Failed to ${decision} request. ${response.statusText}`);
        }
    });

    // Handle Ambiguous Time Choices
    app.action(/ambiguous_earlier|ambiguous_later/, async ({ action, ack, say }) => {
        await ack();

        if (action.type !== 'button') return;
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
            await say?.(`Got it — using the ${choice} time. ✅`);
        } else {
            await say?.(`Failed to resolve that time. ${response.statusText}`);
        }
    });

    // Handle Draft Send/Discard
    app.action(/draft_send|draft_discard/, async ({ action, ack, say }) => {
        await ack();

        if (action.type !== 'button') return;

        const actionId = ("action_id" in action) ? action.action_id : undefined;
        if (!actionId) return;

        // Value format: "draftId:emailAccountId:userId"
        const [draftId, emailAccountId, userId] = (action.value || "").split(":");
        
        if (!draftId || !emailAccountId || !userId) {
            await say?.("Invalid draft action data.");
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
                await say?.("✅ Email sent successfully!");
            } else {
                const error = await response.text();
                await say?.(`❌ Failed to send email: ${error}`);
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
                await say?.("🗑️ Draft discarded.");
            } else {
                await say?.("Failed to discard draft.");
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
                text: `${WELCOME_MESSAGE} Something went wrong generating your link — please try messaging me again in a moment.`,
            });
            return;
        }
        await client.chat.postMessage({
            channel,
            text: `${WELCOME_MESSAGE}\n\n<${linkUrl}|Link your account> → then you can ask me about your calendar, email, and more.`,
            blocks: [
                {
                    type: "section",
                    text: { type: "mrkdwn", text: WELCOME_MESSAGE },
                },
                {
                    type: "section",
                    text: {
                        type: "mrkdwn",
                        text: `To get started, <${linkUrl}|link your Slack account to Amodel> (one-time). Then you can ask me about your calendar, email, and more.`,
                    },
                },
                {
                    type: "section",
                    text: {
                        type: "mrkdwn",
                        text: `If the button doesn't open (e.g. localhost), copy this link and open it in your browser:\n\`${linkUrl}\``,
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
    app.message(async ({ message, say }) => {
        const meta = toMessageMeta(message);
        try {
            touchPlatformEvent("slack");
            console.log("[Surfaces][Slack] Incoming message event", {
                channel: meta.channel,
                user: meta.user,
                ts: meta.ts,
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

            let history: { role: "user" | "assistant"; content: string }[] = [];
            try {
                const result = await app.client.conversations.history({
                    channel: meta.channel,
                    limit: 30,
                    latest: meta.ts,
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
                    channel: meta.channel,
                    user: meta.user,
                    ts: meta.ts,
                    error: err instanceof Error ? err.message : String(err),
                });
            }

            const brainResponse = await forwardToBrain({
                provider: "slack",
                content: meta.text,
                context: {
                    channelId: meta.channel,
                    userId: meta.user,
                    messageId: meta.ts,
                    isDirectMessage: meta.channelType === "im",
                },
                history,
            });

            if (!brainResponse || !Array.isArray(brainResponse.responses)) {
                console.error("[Surfaces][Slack] Brain response missing/invalid", {
                    channel: meta.channel,
                    user: meta.user,
                    ts: meta.ts,
                    hasResponse: Boolean(brainResponse),
                });
                return;
            }

            console.log("[Surfaces][Slack] Brain responses ready", {
                channel: meta.channel,
                user: meta.user,
                ts: meta.ts,
                responseCount: brainResponse.responses.length,
            });

            for (const [index, resp] of brainResponse.responses.entries()) {
                try {
                    if (resp.interactive) {
                        const interactive = resp.interactive as InteractivePayload;
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
                            const bodySnippet =
                                preview.body.length > 500 ? `${preview.body.slice(0, 500)}...` : preview.body;

                            blocks = [
                                {
                                    type: "header",
                                    text: { type: "plain_text", text: "Draft Email", emoji: true },
                                },
                                {
                                    type: "section",
                                    fields: [
                                        { type: "mrkdwn", text: `*To:*\n${preview.to.join(", ")}` },
                                        { type: "mrkdwn", text: `*Subject:*\n${preview.subject || "(no subject)"}` },
                                    ],
                                },
                            ];

                            if (preview.cc && preview.cc.length > 0) {
                                blocks.push({
                                    type: "section",
                                    text: { type: "mrkdwn", text: `*CC:* ${preview.cc.join(", ")}` },
                                });
                            }

                            blocks.push(
                                { type: "divider" },
                                {
                                    type: "section",
                                    text: { type: "mrkdwn", text: bodySnippet },
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
                                        type: "mrkdwn",
                                        text: `*${interactive.summary}*\n${resp.content}`,
                                    },
                                },
                                {
                                    type: "actions",
                                    elements: buttonElements,
                                },
                            ];
                        }

                        await say({
                            blocks: blocks as unknown as (Block | KnownBlock)[],
                            text: resp.content,
                        });
                        console.log("[Surfaces][Slack] Sent interactive response", {
                            channel: meta.channel,
                            user: meta.user,
                            ts: meta.ts,
                            responseIndex: index,
                            interactiveType: interactive.type,
                            actionsCount: interactive.actions.length,
                        });
                    } else if (resp.content) {
                        await say(resp.content);
                        console.log("[Surfaces][Slack] Sent text response", {
                            channel: meta.channel,
                            user: meta.user,
                            ts: meta.ts,
                            responseIndex: index,
                            contentLength: resp.content.length,
                        });
                    } else {
                        console.log("[Surfaces][Slack] Skipped empty outbound response", {
                            channel: meta.channel,
                            user: meta.user,
                            ts: meta.ts,
                            responseIndex: index,
                        });
                    }
                } catch (err) {
                    console.error("[Surfaces][Slack] Failed to send response via Slack API", {
                        channel: meta.channel,
                        user: meta.user,
                        ts: meta.ts,
                        responseIndex: index,
                        hasInteractive: Boolean(resp?.interactive),
                        contentPreview: typeof resp?.content === "string" ? resp.content.slice(0, 120) : null,
                        error: err instanceof Error ? err.message : String(err),
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

export async function sendSlackMessage(channelId: string, text: string, blocks?: (Block | KnownBlock)[]) {
    if (!slackApp) {
        console.error("Slack app not initialized");
        return;
    }
    try {
        await slackApp.client.chat.postMessage({
            channel: channelId,
            text: text,
            blocks: blocks
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
                text: `${WELCOME_MESSAGE} Something went wrong generating your link — please try again in a moment.`,
            });
            return { ok: true };
        }
        await slackApp.client.chat.postMessage({
            channel,
            text: `${WELCOME_MESSAGE}\n\n<${linkUrl}|Link your account> → then you can ask me about your calendar, email, and more.`,
            blocks: [
                { type: "section", text: { type: "mrkdwn", text: WELCOME_MESSAGE } },
                {
                    type: "section",
                    text: {
                        type: "mrkdwn",
                        text: `To get started, <${linkUrl}|link your Slack account to Amodel> (one-time). Then you can ask me about your calendar, email, and more.`,
                    },
                },
                {
                    type: "section",
                    text: {
                        type: "mrkdwn",
                        text: `If the button doesn't open (e.g. localhost), copy this link and open it in your browser:\n\`${linkUrl}\``,
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
