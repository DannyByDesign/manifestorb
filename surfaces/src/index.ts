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
})();
