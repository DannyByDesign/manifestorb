import { NextResponse } from "next/server";
import prisma from "@/server/db/client";
import { createScopedLogger } from "@/server/lib/logger";
import { syncGoogleDriveChanges } from "@/features/drive/sync/google";

export const maxDuration = 300;

export async function POST(request: Request) {
  const logger = createScopedLogger("google/drive/webhook");
  const channelId = request.headers.get("x-goog-channel-id") || "";
  const resourceId = request.headers.get("x-goog-resource-id") || "";
  const channelToken = request.headers.get("x-goog-channel-token") || "";

  if (!channelId || !resourceId) {
    logger.warn("Missing Google Drive webhook headers");
    return NextResponse.json({ ok: false }, { status: 400 });
  }

  const connection = await prisma.driveConnection.findFirst({
    where: {
      provider: "google",
      googleChannelId: channelId,
      googleResourceId: resourceId,
      isConnected: true,
    },
  });

  if (!connection) {
    logger.warn("Drive webhook: connection not found", {
      channelId,
      resourceId,
    });
    return NextResponse.json({ ok: true });
  }

  if (connection.googleChannelToken && connection.googleChannelToken !== channelToken) {
    logger.warn("Drive webhook token mismatch", { connectionId: connection.id });
    return NextResponse.json({ ok: false }, { status: 403 });
  }

  try {
    const syncResult = await syncGoogleDriveChanges({
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
    });

    logger.info("Drive webhook sync completed", {
      connectionId: connection.id,
      changed: syncResult.changed,
      changesCount: syncResult.changes?.length ?? 0,
    });
  } catch (error) {
    logger.error("Drive webhook sync failed", { error });
  }

  return NextResponse.json({ ok: true });
}
