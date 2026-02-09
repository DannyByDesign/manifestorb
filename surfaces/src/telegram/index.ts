
import { Markup, Telegraf } from "telegraf";
import { forwardToBrain, type InteractiveAction, type InteractivePayload } from "../utils";
import {
    setPlatformEnabled,
    setPlatformError,
    setPlatformStarted,
    touchPlatformEvent
} from "../platform-status";

const CORE_BASE_URL = process.env.CORE_BASE_URL || "http://localhost:3000";
const SHARED_SECRET = process.env.SURFACES_SHARED_SECRET || "dev-secret";

export function startTelegram() {
    const token = process.env.TELEGRAM_BOT_TOKEN?.trim();
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
                    await ctx.answerCbQuery("Email sent!");
                    await ctx.editMessageText("✅ Email sent successfully!", { reply_markup: { inline_keyboard: [] } });
                } else {
                    await ctx.answerCbQuery("Failed to send");
                    await ctx.editMessageText("❌ Failed to send email.", { reply_markup: { inline_keyboard: [] } });
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
                    await ctx.answerCbQuery("Draft discarded");
                    await ctx.editMessageText("🗑️ Draft discarded.", { reply_markup: { inline_keyboard: [] } });
                } else {
                    await ctx.answerCbQuery("Failed to discard");
                }
            }
            return;
        }

        // Handle ambiguous time actions (ambiguous:choice:requestId)
        if (data.startsWith("ambiguous:")) {
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
                await ctx.answerCbQuery(`Using the ${choice} time`);
                await ctx.editMessageText(`Got it — using the ${choice} time. ✅`, { reply_markup: { inline_keyboard: [] } });
            } else {
                await ctx.answerCbQuery("Failed to resolve time");
            }
            return;
        }

        // Handle approval actions
        const [action, requestId] = data.split(":");
        if (action !== "approve" && action !== "deny") return;

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

        if (response.ok) {
            await ctx.answerCbQuery(`Request ${action}d!`);
            await ctx.editMessageText(`Request ${action}d! ✅`, { reply_markup: { inline_keyboard: [] } });
        } else {
            await ctx.answerCbQuery(`Failed to ${action}`);
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
                    if (resp.interactive) {
                        const interactive = resp.interactive as InteractivePayload;

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
                                const bodySnippet = preview.body.length > 800
                                    ? preview.body.slice(0, 800) + "..."
                                    : preview.body;

                                // Build rich Markdown preview
                                const lines = [
                                    "*Draft Email*",
                                    "",
                                    `*To:* ${preview.to.join(", ")}`,
                                    `*Subject:* ${preview.subject || "(no subject)"}`
                                ];

                                if (preview.cc && preview.cc.length > 0) {
                                    lines.push(`*CC:* ${preview.cc.join(", ")}`);
                                }

                                lines.push("", "---", "", bodySnippet);
                                messageText = lines.join("\n");
                            } else {
                                // Default for approvals/action requests or drafts without preview
                                messageText = `*${interactive.summary}*\n${resp.content}`;
                            }

                            await ctx.reply(messageText, {
                                parse_mode: "Markdown",
                                ...Markup.inlineKeyboard([buttons])
                            });
                        } catch (err) {
                            console.error("[Surfaces] Failed to reply interactive on Telegram:", err);
                        }

                    } else if (resp.content) {
                        try {
                            await ctx.reply(resp.content);
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
