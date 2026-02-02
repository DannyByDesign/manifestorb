
import { App } from "@slack/bolt";
import { forwardToBrain, type InteractiveAction, type InteractivePayload } from "../utils";

const CORE_BASE_URL = process.env.CORE_BASE_URL || "http://localhost:3000";
const SHARED_SECRET = process.env.SURFACES_SHARED_SECRET || "dev-secret";

export async function startSlack() {
    const token = process.env.SLACK_BOT_TOKEN;
    if (!token) {
        console.log("⚠️ Surfaces: Skipping Slack (SLACK_BOT_TOKEN missing)");
        return;
    }

    // Initialize Slack App in Socket Mode
    const app = new App({
        token: process.env.SLACK_BOT_TOKEN,
        appToken: process.env.SLACK_APP_TOKEN,
        socketMode: true,
    });
    slackApp = app;


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

    // Handle Draft Send/Discard
    app.action(/draft_send|draft_discard/, async ({ body, action, ack, say }) => {
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

    // Listen for messages
    app.message(async ({ message, say }) => {
        // Filter out subtype messages (like 'channel_join') if needed, for now getting basic text
        if (message.subtype && message.subtype !== "file_share") return;
        if (!("text" in message) || !message.text) return; // Skip messages without text

        console.log(`[Surfaces] Received Slack message: ${message.text}`);

        // Fetch History
        let history: { role: "user" | "assistant"; content: string }[] = [];
        try {
            const threadTs = (message as any).thread_ts;
            // If in a thread, get thread replies. If in channel/DM, get history.
            // For simplicity, we just look at conversations.history (which gets channel stream) or replies if threaded.
            // But getting context for "just this channel" is usually safest.

            const result = await app.client.conversations.history({
                channel: message.channel,
                limit: 30,
                latest: message.ts, // Get messages BEFORE this one
                inclusive: false
            });

            if (result.messages) {
                // Reverse to default chronological order
                history = result.messages.reverse().map(msg => ({
                    role: (msg.bot_id ? "assistant" : "user") as "user" | "assistant",
                    content: msg.text || ""
                })).filter(msg => msg.content !== "");
            }
        } catch (err) {
            console.error("[Surfaces] Failed to fetch Slack history", err);
        }

        const brainResponse = await forwardToBrain({
            provider: "slack",
            content: message.text,
            context: {
                channelId: message.channel,
                userId: message.user,
                messageId: message.ts,
                isDirectMessage: message.channel_type === "im",
            },
            history
        });

        if (brainResponse && brainResponse.responses) {
            for (const resp of brainResponse.responses) {
                if (resp.interactive) {
                    const interactive = resp.interactive as InteractivePayload;
                    
                    // Build button elements based on interactive type
                    let buttonElements: any[];
                    
                    if (interactive.type === "draft_created") {
                        // Draft buttons - value includes all IDs needed
                        const buttonValue = `${interactive.draftId}:${interactive.emailAccountId}:${interactive.userId}`;
                        buttonElements = interactive.actions.map((action: InteractiveAction) => {
                            // Skip edit button if it has a URL (handled separately)
                            if (action.url) {
                                return {
                                    type: "button",
                                    text: { type: "plain_text", text: action.label },
                                    url: action.url
                                };
                            }
                            return {
                                type: "button",
                                text: { type: "plain_text", text: action.label },
                                style: action.style === "danger" ? "danger" : "primary",
                                value: buttonValue,
                                action_id: `draft_${action.value}` // draft_send / draft_discard
                            };
                        });
                    } else {
                        // Approval buttons (existing logic)
                        buttonElements = interactive.actions.map((action: InteractiveAction) => ({
                            type: "button",
                            text: { type: "plain_text", text: action.label },
                            style: action.style === "danger" ? "danger" : "primary",
                            value: interactive.approvalId,
                            action_id: `${action.value}_request` // approve_request / deny_request
                        }));
                    }

                    // Build blocks based on interactive type
                    let blocks: any[];
                    
                    if (interactive.type === "draft_created" && interactive.preview) {
                        // Rich draft preview with Block Kit
                        const preview = interactive.preview;
                        const bodySnippet = preview.body.length > 500 
                            ? preview.body.slice(0, 500) + "..." 
                            : preview.body;
                        
                        blocks = [
                            {
                                type: "header",
                                text: { type: "plain_text", text: "Draft Email", emoji: true }
                            },
                            {
                                type: "section",
                                fields: [
                                    { type: "mrkdwn", text: `*To:*\n${preview.to.join(", ")}` },
                                    { type: "mrkdwn", text: `*Subject:*\n${preview.subject || "(no subject)"}` }
                                ]
                            }
                        ];
                        
                        // Add CC if present
                        if (preview.cc && preview.cc.length > 0) {
                            blocks.push({
                                type: "section",
                                text: { type: "mrkdwn", text: `*CC:* ${preview.cc.join(", ")}` }
                            });
                        }
                        
                        // Add body preview
                        blocks.push(
                            { type: "divider" },
                            {
                                type: "section",
                                text: { type: "mrkdwn", text: bodySnippet }
                            },
                            { type: "divider" },
                            {
                                type: "actions",
                                elements: buttonElements
                            }
                        );
                    } else {
                        // Default layout for approvals or drafts without preview
                        blocks = [
                            {
                                type: "section",
                                text: {
                                    type: "mrkdwn",
                                    text: `*${interactive.summary}*\n${resp.content}`
                                }
                            },
                            {
                                type: "actions",
                                elements: buttonElements
                            }
                        ];
                    }

                    await say({ blocks, text: resp.content });
                } else if (resp.content) {
                    await say(resp.content);
                }
            }
        }
    });

    await app.start();
    console.log("⚡️ Surfaces: Slack Socket Mode running");
}

export async function sendSlackMessage(channelId: string, text: string, blocks?: any[]) {
    // We need access to the app instance. 
    // Since startSlack initializes it, we should lift 'app' to module scope or re-architect slightly.
    // For now, let's assume single instance and use a singleton pattern if needed, 
    // but the cleanest way is to export the sender from the closure if we can, or just expose `app`.
    // Actually, let's just use the `app` if it was exported, but it's not.
    // Let's modify startSlack to assign to a module-level variable.
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

let slackApp: App | undefined;
