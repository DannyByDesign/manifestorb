
import { Markup, Telegraf } from "telegraf";
import {
    forwardToBrain,
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
import { env } from "../env";

const CORE_BASE_URL = env.CORE_BASE_URL;
const SHARED_SECRET = env.SURFACES_SHARED_SECRET;

type CallbackButtonContext = {
    editMessageReplyMarkup: (markup: { inline_keyboard: [] }) => Promise<unknown>;
};

async function clearCallbackButtons(ctx: CallbackButtonContext) {
    try {
        await ctx.editMessageReplyMarkup({ inline_keyboard: [] });
    } catch (err) {
        console.warn("[Surfaces][Telegram] Failed to clear callback buttons", {
            error: err instanceof Error ? err.message : String(err),
        });
    }
}

export function startTelegram() {
    const token = env.TELEGRAM_BOT_TOKEN?.trim();
    const tokenLooksPlaceholder =
        !token ||
        token.toLowerCase().includes("replace") ||
        token.toLowerCase().includes("changeme");
    if (tokenLooksPlaceholder) {
        setPlatformEnabled("telegram", false);
        console.log("[Surfaces] Skipping Telegram (TELEGRAM_BOT_TOKEN missing/placeholder)");
        return;
    }
    setPlatformEnabled("telegram", true);

    const bot = new Telegraf(token);

    // Handle Callback Queries (Buttons)
    bot.on("callback_query", async (ctx) => {
        touchPlatformEvent("telegram");
        const data =
            "data" in ctx.callbackQuery && typeof ctx.callbackQuery.data === "string"
                ? ctx.callbackQuery.data
                : null;
        if (!data) return;

        // Handle draft actions (draft_send:draftId:emailAccountId:userId)
        if (data.startsWith("draft_send:") || data.startsWith("draft_discard:")) {
            await clearCallbackButtons(ctx);
            await ctx.answerCbQuery(toPlainSidecarText("Processing..."));

            const parts = data.split(":");
            const action = parts[0]; // draft_send or draft_discard
            const draftId = parts[1];
            const emailAccountId = parts[2];
            const userId = parts[3];

            if (action === "draft_send") {
                console.log(`[Surfaces] Telegram: Sending draft ${draftId}`);
                
                const response = await fetch(`${CORE_BASE_URL}/api/drafts/${draftId}/send`, {
                    method: "POST",
                    headers: {
                        "Content-Type": "application/json",
                        "x-surfaces-secret": SHARED_SECRET,
                    },
                    body: JSON.stringify({ userId, emailAccountId })
                });

                if (response.ok) {
                    await ctx.reply(toPlainSidecarText("success"));
                } else {
                    await ctx.reply(toPlainSidecarText("Failed to send email."));
                }
            } else if (action === "draft_discard") {
                console.log(`[Surfaces] Telegram: Discarding draft ${draftId}`);
                
                const response = await fetch(`${CORE_BASE_URL}/api/drafts/${draftId}?userId=${userId}&emailAccountId=${emailAccountId}`, {
                    method: "DELETE",
                    headers: {
                        "x-surfaces-secret": SHARED_SECRET,
                    }
                });

                if (response.ok) {
                    await ctx.reply(toPlainSidecarText("success"));
                } else {
                    await ctx.reply(toPlainSidecarText("Failed to discard draft."));
                }
            }
            return;
        }

        // Handle ambiguous time actions (ambiguous:choice:requestId)
        if (data.startsWith("ambiguous:")) {
            await clearCallbackButtons(ctx);
            await ctx.answerCbQuery(toPlainSidecarText("Processing..."));

            const [, choice, requestId] = data.split(":");
            if (choice !== "earlier" && choice !== "later") return;

            const response = await fetch(`${CORE_BASE_URL}/api/ambiguous-time/${requestId}/resolve`, {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                    "x-surfaces-secret": SHARED_SECRET,
                },
                body: JSON.stringify({ choice })
            });

            if (response.ok) {
                await ctx.reply(toPlainSidecarText("success"));
            } else {
                await ctx.reply(toPlainSidecarText("Failed to resolve that time."));
            }
            return;
        }

        // Handle approval actions
        const [action, requestId] = data.split(":");
        if (action !== "approve" && action !== "deny") return;

        await clearCallbackButtons(ctx);
        await ctx.answerCbQuery(toPlainSidecarText("Processing..."));

        console.log(`[Surfaces] Telegram: Processing ${action} for request ${requestId}`);

        const response = await fetch(`${CORE_BASE_URL}/api/approvals/${requestId}/${action}`, {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                "x-surfaces-secret": SHARED_SECRET,
            },
            body: JSON.stringify({
                userId: ctx.from.id.toString(),
                provider: "telegram",
            })
        });

        if (!response.ok) {
            await ctx.reply(toPlainSidecarText(`Failed to ${action} request.`));
        }
    });

    bot.on("message", async (ctx) => {
        touchPlatformEvent("telegram");
        // We strictly handle text messages for now
        if (!("text" in ctx.message)) return;

        const text = ctx.message.text;
        const userId = ctx.from.id.toString();
        const chatId = ctx.chat.id.toString();
        const isDM = ctx.chat.type === 'private';
        let typingInterval: ReturnType<typeof setInterval> | null = null;
        const sendTyping = async () => {
            try {
                await ctx.sendChatAction("typing");
            } catch (err) {
                console.error("[Surfaces][Telegram] Failed to send typing indicator", {
                    chatId,
                    messageId: ctx.message.message_id,
                    error: err instanceof Error ? err.message : String(err),
                });
            }
        };
        const startTypingIndicator = async () => {
            await sendTyping();
            typingInterval = setInterval(() => {
                void sendTyping();
            }, 4000);
        };
        const stopTypingIndicator = () => {
            if (typingInterval) {
                clearInterval(typingInterval);
                typingInterval = null;
            }
        };

        try {
            await startTypingIndicator();

            const brainResponse = await forwardToBrain({
                provider: "telegram",
                content: text,
                context: {
                    channelId: chatId,
                    userId: userId,
                    userName: ctx.from.username || ctx.from.first_name,
                    messageId: ctx.message.message_id.toString(),
                    isDirectMessage: isDM
                },
            });

            if (brainResponse && brainResponse.responses) {
                for (const resp of brainResponse.responses) {
                    const plainResponseContent = toPlainSidecarText(
                        typeof resp.content === "string" ? resp.content : "",
                    );
                    if (resp.interactive) {
                        const interactive = resp.interactive as InteractivePayload;
                        const plainInteractiveSummary = toPlainSidecarText(interactive.summary || "");

                        const isDraft = interactive.type === "draft_created";
                        const isApprovalLike = interactive.type === "approval_request" || interactive.type === "action_request";

                        const buttons = interactive.actions.map((action: InteractiveAction) => {
                            // Handle URL buttons (Edit in Gmail) - use url button
                            if (action.url) {
                                return Markup.button.url(action.label, action.url);
                            }

                            // Build callback data based on type
                            if (isDraft) {
                                // draft_send:draftId:emailAccountId:userId
                                return Markup.button.callback(
                                    action.label,
                                    `draft_${action.value}:${interactive.draftId}:${interactive.emailAccountId}:${interactive.userId}`
                                );
                            } else if (interactive.type === "ambiguous_time") {
                                return Markup.button.callback(action.label, `ambiguous:${action.value}:${interactive.ambiguousRequestId}`);
                            } else if (isApprovalLike) {
                                // approve:requestId or deny:requestId
                                return Markup.button.callback(action.label, `${action.value}:${interactive.approvalId}`);
                            }
                            return Markup.button.callback(action.label, action.value);
                        });

                        try {
                            // Build message based on type
                            let messageText: string;

                            if (isDraft && interactive.preview) {
                                const preview = interactive.preview;
                                const previewBody = toPlainSidecarText(preview.body || "");
                                const bodySnippet = previewBody.length > 800
                                    ? previewBody.slice(0, 800) + "..."
                                    : previewBody;

                                // Plain-text preview
                                const lines = [
                                    "Draft Email",
                                    "",
                                    `To: ${preview.to.join(", ")}`,
                                    `Subject: ${preview.subject || "(no subject)"}`
                                ];

                                if (preview.cc && preview.cc.length > 0) {
                                    lines.push(`CC: ${preview.cc.join(", ")}`);
                                }

                                lines.push("", bodySnippet);
                                messageText = lines.join("\n");
                            } else {
                                // Default for approvals/action requests or drafts without preview
                                messageText = [plainInteractiveSummary, plainResponseContent]
                                    .filter((part) => part.length > 0)
                                    .join("\n");
                            }

                            await ctx.reply(toPlainSidecarText(messageText), {
                                ...Markup.inlineKeyboard([buttons])
                            });
                        } catch (err) {
                            console.error("[Surfaces] Failed to reply interactive on Telegram:", err);
                        }

                    } else if (resp.content) {
                        try {
                            await ctx.reply(toPlainSidecarText(plainResponseContent));
                        } catch (err) {
                            console.error("[Surfaces] Failed to reply on Telegram:", err);
                        }
                    }
                }
            }
        } finally {
            stopTypingIndicator();
        }
    });

    bot.launch().then(() => {
        setPlatformStarted("telegram");
        console.log("[Surfaces] Telegram Polling Started");
    }).catch(err => {
        setPlatformError("telegram", err instanceof Error ? err.message : String(err));
        console.error("[Surfaces] Telegram Launch Error:", err);
    });

    // Enable graceful stop
    process.once('SIGINT', () => bot.stop('SIGINT'));
    process.once('SIGTERM', () => bot.stop('SIGTERM'));
}
