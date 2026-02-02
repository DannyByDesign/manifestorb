import { createHash, randomBytes } from "crypto";
import prisma from "@/server/db/client";
import { createScopedLogger } from "@/server/lib/logger";

const logger = createScopedLogger("LinkingUtils");

const LINK_TOKEN_TTL_MINUTES = 10;
const LINK_TOKEN_BYTES = 32;

/**
 * Creates a secure, stateful linking token for an external provider account.
 * Enforces rate limiting (1 active token per user).
 */
export async function createLinkToken({
    provider,
    providerAccountId,
    providerTeamId,
    metadata
}: {
    provider: string;
    providerAccountId: string;
    providerTeamId?: string;
    metadata?: Record<string, unknown>;
}) {
    // 1. Check for existing active token (Rate Limit / Spam Prevention)
    const activeToken = await prisma.surfaceLinkToken.findFirst({
        where: {
            provider,
            providerAccountId,
            expiresAt: { gt: new Date() },
            consumedAt: null
        }
    });

    if (activeToken) {
        // Reuse existing token? No, we can't return the raw token because we only store the hash!
        // So we must actually delete the old one and create a new one, 
        // OR we just return "null" and say "check your DMs" if we want to be strict.
        // But for better UX, let's revoke the old one and issue a new one 
        // (assuming the user lost the old link).

        await prisma.surfaceLinkToken.delete({ where: { id: activeToken.id } });
    }

    // 2. Generate new token
    const rawToken = randomBytes(LINK_TOKEN_BYTES).toString("hex");
    const tokenHash = createHash("sha256").update(rawToken).digest("hex");
    const expiresAt = new Date(Date.now() + LINK_TOKEN_TTL_MINUTES * 60 * 1000);

    // 3. Persist
    await prisma.surfaceLinkToken.create({
        data: {
            tokenHash,
            provider,
            providerAccountId,
            providerTeamId,
            expiresAt,
            metadata: (metadata ?? {}) as any,
        }
    });

    return rawToken;
}

/**
 * Consumes a linking token and links the account to the user.
 */
export async function consumeLinkToken(rawToken: string, userId: string) {
    const tokenHash = createHash("sha256").update(rawToken).digest("hex");

    return await prisma.$transaction(async (tx) => {
        // 1. Find Token
        const linkToken = await tx.surfaceLinkToken.findUnique({
            where: { tokenHash }
        });

        // 2. Validate
        if (!linkToken) {
            throw new Error("Invalid linking token.");
        }
        if (linkToken.consumedAt) {
            throw new Error("This link has already been used.");
        }
        if (new Date() > linkToken.expiresAt) {
            throw new Error("This link has expired. Please ask the bot for a new one.");
        }

        // 3. Mark Consumed
        await tx.surfaceLinkToken.update({
            where: { id: linkToken.id },
            data: { consumedAt: new Date() }
        });

        // 4. Create/Get Account
        // We need to upsert the Account to bind it to the User.
        // Note: 'Account' model usually comes from NextAuth/BetterAuth and requires access_token etc.
        // But for a "bot" account, we might not have tokens yet? 
        // Actually, Surfaces bots don't use user-level tokens usually.
        // But our `Account` schema requires `provider` + `providerAccountId`.

        // Let's user upsert.
        // WARNING: If this account is already linked to another user, we might need to handle that.
        // The `Account` table has a unique constraint on [provider, providerAccountId].

        const existingAccount = await tx.account.findUnique({
            where: {
                provider_providerAccountId: {
                    provider: linkToken.provider,
                    providerAccountId: linkToken.providerAccountId
                }
            }
        });

        if (existingAccount) {
            if (existingAccount.userId === userId) {
                return { success: true, message: "Account was already linked." };
            }
            // Move account to new user? Or throw?
            // Usually re-linking means moving.
            await tx.account.update({
                where: { id: existingAccount.id },
                data: { userId }
            });
        } else {
            await tx.account.create({
                data: {
                    userId,
                    provider: linkToken.provider,
                    providerAccountId: linkToken.providerAccountId,
                    type: "surfaces_bot", // or 'oauth'
                    // We don't have tokens for the user here, just the ID mapping.
                    // This is fine for "Bot" interactions.
                }
            });
        }

        logger.info("Account linked successfully", {
            userId,
            provider: linkToken.provider,
            providerAccountId: linkToken.providerAccountId
        });

        return { success: true, provider: linkToken.provider };
    });
}
