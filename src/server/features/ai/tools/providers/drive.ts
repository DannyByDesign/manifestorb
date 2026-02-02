
import { type Logger } from "@/server/lib/logger";
import prisma from "@/server/db/client";
import { createDriveProviderWithRefresh } from "@/features/drive/provider";
import { type DriveProvider } from "@/features/drive/types";

// Re-export the type so consumers just import this file
export type { DriveProvider } from "@/features/drive/types";

export async function createToolDriveProvider(
    emailAccountId: string,
    logger: Logger
): Promise<DriveProvider> {

    // Find a valid Drive Connection for this account
    // Preference: Same provider as email account?
    // For now, just take the first connected one.
    const connections = await prisma.driveConnection.findMany({
        where: {
            emailAccountId,
            isConnected: true
        }
    });

    if (connections.length === 0) {
        // Fallback: Check if we can create a text-based "Not Connected" provider?
        // Or just throw. Tools should handle errors gracefully.
        throw new Error("No connected Drive account found. Please connect Google Drive or OneDrive in settings.");
    }

    // Prioritize the one that matches the email account provider if possible?
    // Ideally we'd let user select, but for automation we pick the first one.
    const connection = connections[0];

    return await createDriveProviderWithRefresh({
        id: connection.id,
        provider: connection.provider as "google" | "microsoft", // Cast based on schema constraint or validation
        accessToken: connection.accessToken,
        refreshToken: connection.refreshToken,
        expiresAt: connection.expiresAt
    }, logger);
}
