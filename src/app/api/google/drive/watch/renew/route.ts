import { NextResponse } from "next/server";
import { type NextRequest } from "next/server";
import prisma from "@/server/db/client";
import { ensureGoogleDriveWatch } from "@/features/drive/sync/google";
import { createScopedLogger } from "@/server/lib/logger";
import { env } from "@/env";

export const maxDuration = 300;

export async function POST(req: NextRequest) {
  const logger = createScopedLogger("cron/drive-watch-renewal");
  const authHeader = req.headers.get("authorization");

  if (authHeader !== `Bearer ${env.CRON_SECRET}`) {
    logger.warn("Unauthorized attempt to renew drive watches");
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const connections = await prisma.driveConnection.findMany({
      where: { provider: "google", isConnected: true },
    });

    let successCount = 0;
    let errorCount = 0;

    for (const connection of connections) {
      try {
        await ensureGoogleDriveWatch({
          connection: {
            id: connection.id,
            accessToken: connection.accessToken,
            refreshToken: connection.refreshToken,
            expiresAt: connection.expiresAt,
            emailAccountId: connection.emailAccountId,
            googleChannelId: connection.googleChannelId,
            googleResourceId: connection.googleResourceId,
            googleChannelToken: connection.googleChannelToken,
            googleChannelExpiresAt: connection.googleChannelExpiresAt,
            googleStartPageToken: connection.googleStartPageToken,
          },
          logger,
          renewIfExpiresInMs: 6 * 60 * 60 * 1000,
        });
        successCount += 1;
      } catch (error) {
        errorCount += 1;
        logger.error("Failed to renew drive watch", {
          connectionId: connection.id,
          error,
        });
      }
    }

    return NextResponse.json({
      success: true,
      processed: connections.length,
      successful: successCount,
      failed: errorCount,
    });
  } catch (error) {
    logger.error("Critical error during drive watch renewal", { error });
    return NextResponse.json(
      { success: false, error: "Internal Server Error" },
      { status: 500 },
    );
  }
}
