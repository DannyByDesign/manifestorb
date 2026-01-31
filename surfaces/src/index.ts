import { config } from "dotenv";
import { startSlack } from "./slack";
import { startDiscord } from "./discord";
import { startTelegram } from "./telegram";

config();

(async () => {
    // Start Slack
    startSlack();

    // Start Discord
    startDiscord();

    // Start Telegram
    startTelegram();

    console.log("🚀 Surfaces Sidecar fully initialized");

    // @ts-ignore
    const Bun = globalThis.Bun;

    // HTTP Server for Push Notifications
    Bun.serve({
        port: 3001,
        async fetch(req: Request) {
            const url = new URL(req.url);

            if (req.method === "POST" && url.pathname === "/notify") {
                try {
                    const body = await req.json();
                    const { platform, channelId, content } = body;

                    if (!platform || !channelId || !content) {
                        return new Response("Missing required fields", { status: 400 });
                    }

                    if (platform === "slack") {
                        const { sendSlackMessage } = await import("./slack");
                        await sendSlackMessage(channelId, content);
                        return new Response("Notification sent to Slack", { status: 200 });
                    }

                    if (platform === "discord") {
                        const { sendDiscordMessage } = await import("./discord");
                        await sendDiscordMessage(channelId, content);
                        return new Response("Notification sent to Discord", { status: 200 });
                    }

                    return new Response("Unsupported platform", { status: 400 });

                } catch (err) {
                    console.error("Failed to process notification", err);
                    return new Response("Internal Server Error", { status: 500 });
                }
            }

            return new Response("Not Found", { status: 404 });
        }
    });

    console.log("🔔 Notification Server listening on port 3001");
})();
