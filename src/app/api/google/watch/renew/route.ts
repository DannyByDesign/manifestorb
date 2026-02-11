
import { NextResponse } from "next/server";
import { ensureEmailAccountsWatched } from "@/features/email/watch-manager";
import { createScopedLogger } from "@/server/lib/logger";
import { env } from "@/env";
import { withQStashSignatureAppRouter } from "@/server/lib/qstash";

// Maximum duration for Vercel/Next.js functions
export const maxDuration = 300; // 5 minutes

export const POST = withQStashSignatureAppRouter(async (req: Request) => {
    const logger = createScopedLogger("cron/watch-renewal");

    // 1. Verify Authentication
    // We accept either a QStash signature (if configured) or a simple CRON_SECRET
    const authHeader = req.headers.get("authorization");

    // Simple bearer token check for "CRON_SECRET"
    // In a real production environment with QStash, you'd use verifySignature from @upstash/qstash
    if (authHeader !== `Bearer ${env.CRON_SECRET}`) {
        logger.warn("Unauthorized attempt to renew watches");
        return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    try {
        logger.info("Starting scheduled watch renewal");

        // 2. Renew watches for ALL applicable accounts
        // ensureEmailAccountsWatched with userIds: null renewal for all active premium accounts
        const results = await ensureEmailAccountsWatched({
            userIds: null,
            logger,
        });

        const successCount = results.filter((r) => r.status === "success").length;
        const errorCount = results.filter((r) => r.status === "error").length;

        logger.info("Watch renewal completed", { successCount, errorCount });

        return NextResponse.json({
            success: true,
            processed: results.length,
            successful: successCount,
            failed: errorCount,
        });
    } catch (error) {
        logger.error("Critical error during watch renewal", { error });
        return NextResponse.json(
            { success: false, error: "Internal Server Error" },
            { status: 500 }
        );
    }
});
