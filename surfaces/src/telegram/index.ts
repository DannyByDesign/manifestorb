
import { Telegraf } from "telegraf";
import { forwardToBrain, type InteractiveAction } from "../utils";

export function startTelegram() {
    const token = process.env.TELEGRAM_BOT_TOKEN;
    if (!token) {
        console.log("[Surfaces] Skipping Telegram (TELEGRAM_BOT_TOKEN not set)");
        return;
    }

    const bot = new Telegraf(token);

    // Handle Callback Queries (Buttons)
    bot.on("callback_query", async (ctx) => {
        // @ts-ignore - Telegraf types can be tricky with callback_query generic, assuming data exists
        const data = ctx.callbackQuery.data;
        if (!data) return;

        const [action, requestId] = data.split(":");
        if (action !== "approve" && action !== "deny") return;

        console.log(`[Surfaces] Telegram: Processing ${action} for request ${requestId}`);

        // Call Brain API
        const brainUrl = process.env.BRAIN_API_URL || "http://localhost:3000";
        const response = await fetch(`${brainUrl}/api/approvals/${requestId}/${action}`, {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                "x-surfaces-secret": process.env.SURFACES_SHARED_SECRET || "dev-secret",
            },
            body: JSON.stringify({
                userId: ctx.from.id.toString(),
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
        // We strictly handle text messages for now
        if (!("text" in ctx.message)) return;

        const text = ctx.message.text;
        const userId = ctx.from.id.toString();
        const chatId = ctx.chat.id.toString();
        const isDM = ctx.chat.type === 'private';

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
            const { Markup } = require("telegraf");

            for (const resp of brainResponse.responses) {
                if (resp.interactive) {
                    const buttons = resp.interactive.actions.map((action: InteractiveAction) =>
                        Markup.button.callback(action.label, `${action.value}:${resp.interactive.approvalId}`) // approve:123
                    );

                    try {
                        await ctx.reply(`*${resp.interactive.summary}*\n${resp.content}`, {
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
    });

    bot.launch().then(() => {
        console.log("[Surfaces] Telegram Polling Started");
    }).catch(err => {
        console.error("[Surfaces] Telegram Launch Error:", err);
    });

    // Enable graceful stop
    process.once('SIGINT', () => bot.stop('SIGINT'));
    process.once('SIGTERM', () => bot.stop('SIGTERM'));
}
