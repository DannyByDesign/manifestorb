
import { Client, GatewayIntentBits, Partials, ChannelType } from "discord.js";
import { forwardToBrain, type InteractiveAction, type InteractivePayload } from "../utils";

const CORE_BASE_URL = process.env.CORE_BASE_URL || "http://localhost:3000";
const SHARED_SECRET = process.env.SURFACES_SHARED_SECRET || "dev-secret";

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
    discordClient = client;

    client.once("ready", () => {
        console.log(`[Surfaces] Discord Connected as ${client.user?.tag}`);
    });

    client.on("interactionCreate", async (interaction) => {
        if (!interaction.isButton()) return;

        const customId = interaction.customId;
        
        // Handle draft actions (draft_send:draftId:emailAccountId:userId)
        if (customId.startsWith("draft_send:") || customId.startsWith("draft_discard:")) {
            const parts = customId.split(":");
            const action = parts[0]; // draft_send or draft_discard
            const draftId = parts[1];
            const emailAccountId = parts[2];
            const userId = parts[3];

            await interaction.deferReply();

            if (action === "draft_send") {
                console.log(`[Surfaces] Discord: Sending draft ${draftId}`);
                
                const response = await fetch(`${CORE_BASE_URL}/api/drafts/${draftId}/send`, {
                    method: "POST",
                    headers: {
                        "Content-Type": "application/json",
                        "x-surfaces-secret": SHARED_SECRET,
                    },
                    body: JSON.stringify({ userId, emailAccountId })
                });

                if (response.ok) {
                    await interaction.editReply({
                        content: "✅ Email sent successfully!",
                        components: []
                    });
                } else {
                    await interaction.editReply("❌ Failed to send email.");
                }
            } else if (action === "draft_discard") {
                console.log(`[Surfaces] Discord: Discarding draft ${draftId}`);
                
                const response = await fetch(`${CORE_BASE_URL}/api/drafts/${draftId}?userId=${userId}&emailAccountId=${emailAccountId}`, {
                    method: "DELETE",
                    headers: {
                        "x-surfaces-secret": SHARED_SECRET,
                    }
                });

                if (response.ok) {
                    await interaction.editReply({
                        content: "🗑️ Draft discarded.",
                        components: []
                    });
                } else {
                    await interaction.editReply("Failed to discard draft.");
                }
            }
            return;
        }

        // Handle ambiguous time actions (ambiguous:choice:requestId)
        if (customId.startsWith("ambiguous:")) {
            const [, choice, requestId] = customId.split(":");
            if (choice !== "earlier" && choice !== "later") return;

            await interaction.deferReply();

            const response = await fetch(`${CORE_BASE_URL}/api/ambiguous-time/${requestId}/resolve`, {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                    "x-surfaces-secret": SHARED_SECRET,
                },
                body: JSON.stringify({ choice })
            });

            if (response.ok) {
                await interaction.editReply({
                    content: `Got it — using the ${choice} time. ✅`,
                    components: []
                });
            } else {
                await interaction.editReply("Failed to resolve that time.");
            }
            return;
        }

        // Handle approval actions (approve:requestId or deny:requestId)
        const [action, requestId] = customId.split(":");
        if (action !== "approve" && action !== "deny") return;

        await interaction.deferReply();

        console.log(`[Surfaces] Discord: Processing ${action} for request ${requestId}`);

        const response = await fetch(`${CORE_BASE_URL}/api/approvals/${requestId}/${action}`, {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                "x-surfaces-secret": SHARED_SECRET,
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

        // Fetch History
        let history: { role: "user" | "assistant"; content: string }[] = [];
        try {
            const messages = await message.channel.messages.fetch({ limit: 30, before: message.id });
            history = messages.reverse().map(msg => ({
                role: (msg.author.bot ? "assistant" : "user") as "user" | "assistant",
                content: msg.content
            })).filter(msg => msg.content !== "");
        } catch (err) {
            console.error("[Surfaces] Failed to fetch Discord history", err);
        }

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
            history
        });

        if (brainResponse && brainResponse.responses) {
            const { ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder } = require("discord.js");

            for (const resp of brainResponse.responses) {
                if (resp.interactive) {
                    const interactive = resp.interactive as InteractivePayload;
                    
                    const isDraft = interactive.type === "draft_created";
                    const isApprovalLike = interactive.type === "approval_request" || interactive.type === "action_request";

                    const buttons = interactive.actions.map((action: InteractiveAction) => {
                        const btn = new ButtonBuilder()
                            .setLabel(action.label)
                            .setStyle(action.style === 'danger' ? ButtonStyle.Danger : ButtonStyle.Primary);

                        // Handle URL buttons (Edit in Gmail)
                        if (action.url) {
                            return btn.setStyle(ButtonStyle.Link).setURL(action.url);
                        }

                        // Build customId based on type
                        if (isDraft) {
                            // draft_send:draftId:emailAccountId:userId
                            return btn.setCustomId(`draft_${action.value}:${interactive.draftId}:${interactive.emailAccountId}:${interactive.userId}`);
                        } else if (interactive.type === "ambiguous_time") {
                            return btn.setCustomId(`ambiguous:${action.value}:${interactive.ambiguousRequestId}`);
                        } else if (isApprovalLike) {
                            // approve:requestId or deny:requestId
                            return btn.setCustomId(`${action.value}:${interactive.approvalId}`);
                        }
                        return btn;
                    });

                    const row = new ActionRowBuilder().addComponents(buttons);

                    try {
                        // Build message options based on type
                        if (isDraft && interactive.preview) {
                            const preview = interactive.preview;
                            const bodySnippet = preview.body.length > 1000 
                                ? preview.body.slice(0, 1000) + "..." 
                                : preview.body;
                            
                            const embed = new EmbedBuilder()
                                .setTitle("Draft Email")
                                .addFields(
                                    { name: "To", value: preview.to.join(", ") || "N/A", inline: true },
                                    { name: "Subject", value: preview.subject || "(no subject)", inline: true }
                                )
                                .setDescription(bodySnippet)
                                .setColor(0x5865F2); // Discord blurple
                            
                            // Add CC if present
                            if (preview.cc && preview.cc.length > 0) {
                                embed.addFields({ name: "CC", value: preview.cc.join(", "), inline: true });
                            }
                            
                            await message.reply({
                                embeds: [embed],
                                components: [row]
                            });
                        } else {
                            // Default for approvals/action requests or drafts without preview
                            await message.reply({
                                content: `**${interactive.summary}**\n${resp.content}`,
                                components: [row]
                            });
                        }
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

let discordClient: Client | undefined;

export async function sendDiscordMessage(channelId: string, content: string) {
    if (!discordClient) {
        console.error("Discord client not initialized");
        return;
    }
    try {
        const channel = await discordClient.channels.fetch(channelId);
        // Only send if it's a text-based channel (TextChannel, DMChannel, Thread, etc.)
        // @ts-ignore - isTextBased() exists on all sendable channels but types are tricky
        if (channel && channel.isTextBased()) {
            // @ts-ignore
            await channel.send(content);
        }
    } catch (error) {
        console.error("Failed to send Discord message", error);
    }
}
