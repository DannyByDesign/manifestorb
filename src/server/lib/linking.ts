import { createHash, randomBytes } from "crypto";
import prisma from "@/server/db/client";
import { createScopedLogger } from "@/server/lib/logger";
import { decryptToken, encryptToken } from "@/server/lib/encryption";
import type { Prisma } from "@/generated/prisma/client";

const logger = createScopedLogger("LinkingUtils");

const LINK_TOKEN_TTL_MINUTES = 10;
const LINK_TOKEN_BYTES = 32;
const LINK_TOKEN_ENC_KEY = "tokenEnc";

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
    // 1. Check for existing active token (Spam Prevention + Better UX)
    // If we have an active token, reuse it. This prevents rotating tokens on every surfaces message
    // (which would invalidate the link the user just received).
    const activeToken = await prisma.surfaceLinkToken.findFirst({
        where: {
            provider,
            providerAccountId,
            expiresAt: { gt: new Date() },
            consumedAt: null
        }
    });

    if (activeToken) {
        const enc =
            activeToken.metadata &&
            typeof activeToken.metadata === "object" &&
            (activeToken.metadata as Record<string, unknown>)[LINK_TOKEN_ENC_KEY];
        const encToken = typeof enc === "string" ? enc : null;
        const raw = decryptToken(encToken);
        if (raw) {
            return raw;
        }

        // Legacy tokens (or corrupted metadata) cannot be reused; revoke and issue a new token.
        await prisma.surfaceLinkToken.delete({ where: { id: activeToken.id } });
    }

    // 2. Generate new token
    const rawToken = randomBytes(LINK_TOKEN_BYTES).toString("hex");
    const tokenHash = createHash("sha256").update(rawToken).digest("hex");
    const expiresAt = new Date(Date.now() + LINK_TOKEN_TTL_MINUTES * 60 * 1000);

    const tokenEnc = encryptToken(rawToken);
    const mergedMetadata: Record<string, unknown> = {
        ...(metadata ?? {}),
        ...(tokenEnc ? { [LINK_TOKEN_ENC_KEY]: tokenEnc } : {}),
    };

    // 3. Persist
    await prisma.surfaceLinkToken.create({
        data: {
            tokenHash,
            provider,
            providerAccountId,
            providerTeamId,
            expiresAt,
            metadata: mergedMetadata as Prisma.InputJsonValue,
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
                return {
                    success: true,
                    provider: linkToken.provider,
                    providerAccountId: linkToken.providerAccountId,
                    providerTeamId: linkToken.providerTeamId ?? null,
                    message: "Account was already linked.",
                };
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

        return {
            success: true,
            provider: linkToken.provider,
            providerAccountId: linkToken.providerAccountId,
            providerTeamId: linkToken.providerTeamId ?? null,
        };
    });
}
