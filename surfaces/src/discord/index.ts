
import { Client, GatewayIntentBits, Partials, ChannelType } from "discord.js";
import { forwardToBrain, type InteractiveAction } from "../utils";

export function startDiscord() {
    const token = process.env.DISCORD_BOT_TOKEN;
    if (!token) {
        console.log("[Surfaces] Skipping Discord (DISCORD_BOT_TOKEN not set)");
        return;
    }

    const client = new Client({
        intents: [
            GatewayIntentBits.Guilds,
            GatewayIntentBits.GuildMessages,
            GatewayIntentBits.DirectMessages,
            GatewayIntentBits.MessageContent,
        ],
        partials: [Partials.Channel], // Required for DMs
    });

    client.once("ready", () => {
        console.log(`[Surfaces] Discord Connected as ${client.user?.tag}`);
    });

    client.on("interactionCreate", async (interaction) => {
        if (!interaction.isButton()) return;

        const [action, requestId] = interaction.customId.split(":");
        if (action !== "approve" && action !== "deny") return;

        await interaction.deferReply();

        console.log(`[Surfaces] Discord: Processing ${action} for request ${requestId}`);

        // Call Brain API
        const brainUrl = process.env.BRAIN_API_URL || "http://localhost:3000";
        const response = await fetch(`${brainUrl}/api/approvals/${requestId}/${action}`, {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                "x-surfaces-secret": process.env.SURFACES_SHARED_SECRET || "dev-secret",
            },
            body: JSON.stringify({
                userId: interaction.user.id,
            })
        });

        if (response.ok) {
            await interaction.editReply({
                content: `Request ${action}d! ✅`,
                components: [] // Remove buttons
            });
        } else {
            await interaction.editReply(`Failed to ${action} request.`);
        }
    });

    client.on("messageCreate", async (message) => {
        if (message.author.bot) return;

        // Normalize
        const isDM = message.channel.type === ChannelType.DM;

        // Determine channel ID format (e.g. "discord:channel_id" or just "channel_id")
        // For now we send raw ID and provider identifies the namespace

        const brainResponse = await forwardToBrain({
            provider: "discord",
            content: message.content,
            context: {
                channelId: message.channelId,
                userId: message.author.id,
                userName: message.author.username,
                messageId: message.id,
                isDirectMessage: isDM,
                guildId: message.guildId,
            },
        });

        if (brainResponse && brainResponse.responses) {
            const { ActionRowBuilder, ButtonBuilder, ButtonStyle } = require("discord.js"); // Late require to avoid top-level issues if needed, or better: import at top

            for (const resp of brainResponse.responses) {
                if (resp.interactive) {
                    const row = new ActionRowBuilder()
                        .addComponents(
                            resp.interactive.actions.map((action: InteractiveAction) =>
                                new ButtonBuilder()
                                    .setCustomId(`${action.value}:${resp.interactive.approvalId}`) // approve:123
                                    .setLabel(action.label)
                                    .setStyle(action.style === 'danger' ? ButtonStyle.Danger : ButtonStyle.Primary) // Primary = Blurple, Danger = Red
                            )
                        );

                    try {
                        await message.reply({
                            content: `**${resp.interactive.summary}**\n${resp.content}`,
                            components: [row]
                        });
                    } catch (err) {
                        console.error("[Surfaces] Failed to reply interactive on Discord:", err);
                    }
                } else if (resp.content) {
                    try {
                        await message.reply(resp.content);
                    } catch (err) {
                        console.error("[Surfaces] Failed to reply on Discord:", err);
                    }
                }
            }
        }
    });

    client.login(token).catch(err => {
        console.error("[Surfaces] Discord Login Error:", err);
    });
}
