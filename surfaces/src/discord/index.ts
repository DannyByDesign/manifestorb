
import {
    ActionRowBuilder,
    type ButtonInteraction,
    ButtonBuilder,
    ButtonStyle,
    ChannelType,
    Client,
    GatewayIntentBits,
    Partials
} from "discord.js";
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

const CORE_BASE_URL = process.env.CORE_BASE_URL || "http://localhost:3000";
const SHARED_SECRET = process.env.SURFACES_SHARED_SECRET || "dev-secret";

async function clearInteractionButtons(interaction: ButtonInteraction) {
    const currentContent = toPlainSidecarText(
        typeof interaction.message.content === "string" && interaction.message.content.length > 0
            ? interaction.message.content
            : "Processing request...",
    );

    try {
        await interaction.update({
            content: currentContent,
            components: []
        });
    } catch (err) {
        console.warn("[Surfaces][Discord] Failed to clear interaction buttons", {
            interactionId: interaction.id,
            messageId: interaction.message.id,
            error: err instanceof Error ? err.message : String(err),
        });
        if (!interaction.deferred && !interaction.replied) {
            await interaction.deferUpdate();
        }
    }
}

export function startDiscord() {
    const token = process.env.DISCORD_BOT_TOKEN?.trim();
    const tokenLooksPlaceholder =
        !token ||
        token.toLowerCase().includes("replace") ||
        token.toLowerCase().includes("changeme");
    if (tokenLooksPlaceholder) {
        setPlatformEnabled("discord", false);
        console.log("[Surfaces] Skipping Discord (DISCORD_BOT_TOKEN missing/placeholder)");
        return;
    }
    setPlatformEnabled("discord", true);

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
        setPlatformStarted("discord");
        console.log(`[Surfaces] Discord Connected as ${client.user?.tag}`);
    });

    client.on("interactionCreate", async (interaction) => {
        touchPlatformEvent("discord");
        if (!interaction.isButton()) return;

        const customId = interaction.customId;
        
        // Handle draft actions (draft_send:draftId:emailAccountId:userId)
        if (customId.startsWith("draft_send:") || customId.startsWith("draft_discard:")) {
            await clearInteractionButtons(interaction);

            const parts = customId.split(":");
            const action = parts[0]; // draft_send or draft_discard
            const draftId = parts[1];
            const emailAccountId = parts[2];
            const userId = parts[3];

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
                    await interaction.followUp(toPlainSidecarText("success"));
                } else {
                    await interaction.followUp(toPlainSidecarText("Failed to send email."));
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
                    await interaction.followUp(toPlainSidecarText("success"));
                } else {
                    await interaction.followUp(toPlainSidecarText("Failed to discard draft."));
                }
            }
            return;
        }

        // Handle ambiguous time actions (ambiguous:choice:requestId)
        if (customId.startsWith("ambiguous:")) {
            await clearInteractionButtons(interaction);

            const [, choice, requestId] = customId.split(":");
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
                await interaction.followUp(toPlainSidecarText("success"));
            } else {
                await interaction.followUp(toPlainSidecarText("Failed to resolve that time."));
            }
            return;
        }

        // Handle approval actions (approve:requestId or deny:requestId)
        const [action, requestId] = customId.split(":");
        if (action !== "approve" && action !== "deny") return;

        await clearInteractionButtons(interaction);

        console.log(`[Surfaces] Discord: Processing ${action} for request ${requestId}`);

        const response = await fetch(`${CORE_BASE_URL}/api/approvals/${requestId}/${action}`, {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                "x-surfaces-secret": SHARED_SECRET,
            },
            body: JSON.stringify({
                userId: interaction.user.id,
                provider: "discord",
            })
        });

        if (!response.ok) {
            await interaction.followUp(toPlainSidecarText(`Failed to ${action} request.`));
        }
    });

    client.on("messageCreate", async (message) => {
        touchPlatformEvent("discord");
        if (message.author.bot) return;

        let typingInterval: ReturnType<typeof setInterval> | null = null;
        const sendTyping = async () => {
            try {
                await message.channel.sendTyping();
            } catch (err) {
                console.error("[Surfaces][Discord] Failed to send typing indicator", {
                    channelId: message.channelId,
                    messageId: message.id,
                    error: err instanceof Error ? err.message : String(err),
                });
            }
        };
        const startTypingIndicator = async () => {
            await sendTyping();
            typingInterval = setInterval(() => {
                void sendTyping();
            }, 8000);
        };
        const stopTypingIndicator = () => {
            if (typingInterval) {
                clearInterval(typingInterval);
                typingInterval = null;
            }
        };

        // Normalize
        const isDM = message.channel.type === ChannelType.DM;
        try {
            await startTypingIndicator();

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

                        const row = new ActionRowBuilder<ButtonBuilder>().addComponents(buttons);

                        try {
                            // Build message options based on type
                            if (isDraft && interactive.preview) {
                                const preview = interactive.preview;
                                const previewBody = toPlainSidecarText(preview.body || "");
                                const bodySnippet = previewBody.length > 1000
                                    ? previewBody.slice(0, 1000) + "..."
                                    : previewBody;
                                const lines = [
                                    "Draft Email",
                                    "",
                                    `To: ${preview.to.join(", ") || "N/A"}`,
                                    `Subject: ${preview.subject || "(no subject)"}`,
                                ];
                                if (preview.cc && preview.cc.length > 0) {
                                    lines.push(`CC: ${preview.cc.join(", ")}`);
                                }
                                lines.push("", bodySnippet || "(empty body)");

                                await message.reply({
                                    content: lines.join("\n"),
                                    components: [row]
                                });
                            } else {
                                // Default for approvals/action requests or drafts without preview
                                await message.reply({
                                    content: [plainInteractiveSummary, plainResponseContent]
                                        .filter((part) => part.length > 0)
                                        .join("\n"),
                                    components: [row]
                                });
                            }
                        } catch (err) {
                            console.error("[Surfaces] Failed to reply interactive on Discord:", err);
                        }
                    } else if (resp.content) {
                        try {
                            await message.reply(plainResponseContent);
                        } catch (err) {
                            console.error("[Surfaces] Failed to reply on Discord:", err);
                        }
                    }
                }
            }
        } finally {
            stopTypingIndicator();
        }
    });

    client.login(token).catch(err => {
        setPlatformError("discord", err instanceof Error ? err.message : String(err));
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
        if (channel && channel.isTextBased() && "send" in channel) {
            await channel.send(toPlainSidecarText(content));
        }
    } catch (error) {
        console.error("Failed to send Discord message", error);
    }
}
