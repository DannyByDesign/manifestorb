import { auth, drive, type drive_v3 } from "@googleapis/drive";
import { randomUUID } from "crypto";
import prisma from "@/server/db/client";
import type { Logger } from "@/server/lib/logger";
import { env } from "@/env";
import { refreshGoogleDriveToken } from "@/features/drive/providers/google-token";

type DriveConnectionTokens = {
  id: string;
  accessToken: string | null;
  refreshToken: string | null;
  expiresAt: Date | null;
  emailAccountId: string;
  googleChannelId: string | null;
  googleResourceId: string | null;
  googleChannelToken: string | null;
  googleChannelExpiresAt: Date | null;
  googleStartPageToken: string | null;
};

async function getGoogleDriveAccessToken(
  connection: DriveConnectionTokens,
  logger: Logger,
) {
  const needsRefresh =
    !connection.accessToken ||
    !connection.expiresAt ||
    connection.expiresAt.getTime() <= Date.now() + 60 * 1000;
  if (!needsRefresh) return connection.accessToken;
  return refreshGoogleDriveToken(
    { id: connection.id, refreshToken: connection.refreshToken },
    logger,
  );
}

async function getDriveClient(
  connection: DriveConnectionTokens,
  logger: Logger,
): Promise<drive_v3.Drive> {
  const accessToken = await getGoogleDriveAccessToken(connection, logger);
  const googleAuth = new auth.OAuth2({
    clientId: env.GOOGLE_CLIENT_ID,
    clientSecret: env.GOOGLE_CLIENT_SECRET,
  });
  googleAuth.setCredentials({ access_token: accessToken });
  return drive({ version: "v3", auth: googleAuth });
}

export async function ensureGoogleDriveWatch({
  connection,
  logger,
  renewIfExpiresInMs = 6 * 60 * 60 * 1000,
}: {
  connection: DriveConnectionTokens;
  logger: Logger;
  renewIfExpiresInMs?: number;
}) {
  if (!env.NEXT_PUBLIC_BASE_URL) {
    logger.warn("Missing NEXT_PUBLIC_BASE_URL; skipping Drive watch");
    return;
  }

  const now = Date.now();
  if (
    connection.googleChannelId &&
    connection.googleResourceId &&
    connection.googleChannelExpiresAt &&
    connection.googleChannelExpiresAt.getTime() > now + renewIfExpiresInMs
  ) {
    return;
  }

  const client = await getDriveClient(connection, logger);
  const address = new URL(
    "/api/google/drive/webhook",
    env.NEXT_PUBLIC_BASE_URL,
  ).toString();

  if (!connection.googleStartPageToken) {
    const startTokenResponse = await client.changes.getStartPageToken();
    const startPageToken = startTokenResponse.data.startPageToken ?? null;
    await prisma.driveConnection.update({
      where: { id: connection.id },
      data: { googleStartPageToken: startPageToken },
    });
    connection.googleStartPageToken = startPageToken;
  }

  const channelId = randomUUID();
  const channelToken = randomUUID();
  const watchResponse = await client.changes.watch({
    pageToken: connection.googleStartPageToken ?? undefined,
    requestBody: {
      id: channelId,
      type: "web_hook",
      address,
      token: channelToken,
    },
  });

  const resourceId = watchResponse.data.resourceId ?? null;
  const expiration = watchResponse.data.expiration
    ? new Date(Number(watchResponse.data.expiration))
    : null;

  await prisma.driveConnection.update({
    where: { id: connection.id },
    data: {
      googleChannelId: channelId,
      googleResourceId: resourceId,
      googleChannelToken: channelToken,
      googleChannelExpiresAt: expiration,
    },
  });
}

export async function syncGoogleDriveChanges({
  connection,
  logger,
}: {
  connection: DriveConnectionTokens;
  logger: Logger;
}) {
  const client = await getDriveClient(connection, logger);
  if (!connection.googleStartPageToken) {
    const startTokenResponse = await client.changes.getStartPageToken();
    connection.googleStartPageToken =
      startTokenResponse.data.startPageToken ?? null;
  }

  if (!connection.googleStartPageToken) {
    return { changed: false, changes: [] };
  }

  const response = await client.changes.list({
    pageToken: connection.googleStartPageToken,
    spaces: "drive",
    fields: "nextPageToken,newStartPageToken,changes(fileId,changeType,removed,file(name,mimeType,trashed))",
  });

  const newStartPageToken =
    response.data.newStartPageToken ?? response.data.nextPageToken ?? null;
  if (newStartPageToken) {
    await prisma.driveConnection.update({
      where: { id: connection.id },
      data: { googleStartPageToken: newStartPageToken },
    });
  }

  return {
    changed: (response.data.changes || []).length > 0,
    changes: response.data.changes || [],
  };
}
