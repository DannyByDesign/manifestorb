
import { App } from "@slack/bolt";
import { forwardToBrain, type InteractiveAction } from "../utils";

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
        const response = await fetch(`${process.env.BRAIN_API_URL}/api/approvals/${requestId}/${decision}`, {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                "x-surfaces-secret": process.env.SURFACES_SHARED_SECRET || "dev-secret",
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
                    // Render Block Kit Buttons
                    const blocks = [
                        {
                            type: "section",
                            text: {
                                type: "mrkdwn",
                                text: `*${resp.interactive.summary}*\n${resp.content}`
                            }
                        },
                        {
                            type: "actions",
                            elements: resp.interactive.actions.map((action: InteractiveAction) => ({
                                type: "button",
                                text: {
                                    type: "plain_text",
                                    text: action.label
                                },
                                style: action.style === "danger" ? "danger" : "primary",
                                value: resp.interactive.approvalId, // Pass ID as value
                                action_id: `${action.value}_request` // approve_request / deny_request
                            }))
                        }
                    ];

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
