import type { EmailAccount } from "@/generated/prisma/client";

export interface ResolveEmailAccountOptions {
    allowImplicit?: boolean;
}

/**
 * Resolve the best email account for a given context.
 * Priority: explicit emailAccountId > single connected account > most recently active account.
 */
export function resolveEmailAccount(
    user: { emailAccounts: EmailAccount[] },
    preferredEmailAccountId?: string | null,
    options: ResolveEmailAccountOptions = {},
): EmailAccount | null {
    if (!user.emailAccounts.length) return null;
    const allowImplicit = options.allowImplicit !== false;

    if (preferredEmailAccountId) {
        const match = user.emailAccounts.find((ea) => ea.id === preferredEmailAccountId);
        if (match) return match;
    }

    if (user.emailAccounts.length === 1) {
        return user.emailAccounts[0] ?? null;
    }

    if (!allowImplicit) {
        return null;
    }

    const sortedByRecentActivity = [...user.emailAccounts].sort(
        (left, right) => right.updatedAt.getTime() - left.updatedAt.getTime(),
    );
    return sortedByRecentActivity[0] ?? null;
}

export function resolveEmailAccountFromMessageHint(
    user: { emailAccounts: EmailAccount[] },
    message: string | null | undefined,
): EmailAccount | null {
    if (!message || user.emailAccounts.length === 0) return null;
    const accountByEmail = new Map(
        user.emailAccounts.map((account) => [account.email.toLowerCase(), account]),
    );
    const matches = message.match(/[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/giu) ?? [];
    for (const match of matches) {
        const account = accountByEmail.get(match.toLowerCase());
        if (account) return account;
    }
    return null;
}
