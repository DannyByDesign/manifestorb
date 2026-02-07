import type { EmailAccount } from "@/generated/prisma/client";

/**
 * Resolve the best email account for a given context.
 * Priority: explicit emailAccountId > primary account (when added) > first account.
 */
export function resolveEmailAccount(
    user: { emailAccounts: EmailAccount[] },
    preferredEmailAccountId?: string | null,
): EmailAccount | null {
    if (!user.emailAccounts.length) return null;

    if (preferredEmailAccountId) {
        const match = user.emailAccounts.find((ea) => ea.id === preferredEmailAccountId);
        if (match) return match;
    }

    return user.emailAccounts[0] ?? null;
}
