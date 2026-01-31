
import prisma from "@/server/db/client";
import { PrivacySettings } from "@/generated/prisma/client";

export class PrivacyService {
    static async getSettings(userId: string): Promise<PrivacySettings> {
        const settings = await prisma.privacySettings.findUnique({
            where: { userId }
        });

        if (settings) return settings;

        // Create default
        return prisma.privacySettings.create({
            data: {
                userId,
                recordHistory: true,
                retentionDays: 90
            }
        });
    }

    static async shouldRecord(userId: string): Promise<boolean> {
        const settings = await this.getSettings(userId);
        return settings.recordHistory;
    }
}
