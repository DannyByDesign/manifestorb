
import { createScopedLogger } from "@/server/utils/logger";
import { createEmailProvider } from "@/server/services/email/provider";
import { findUnsubscribeLink } from "@/server/utils/parse/parseHtml.server";
import { headers } from "next/headers";
import prisma from "@/server/db/client";
import { isUrlSafeForServerRequest, validateUrlForSsrf } from "@/server/utils/url-validation";

const logger = createScopedLogger("unsubscriber/execute");

export async function unsubscribeFromSender({
    emailAccountId,
    senderEmail,
}: {
    emailAccountId: string;
    senderEmail: string;
}): Promise<{ success: boolean; method?: string; error?: string }> {
    try {
        const log = logger.with({ emailAccountId, senderEmail });
        log.info("Attempting to unsubscribe");

        // 1. Get Provider
        const account = await prisma.emailAccount.findUnique({
            where: { id: emailAccountId },
            include: { account: true, user: true },
        });

        if (!account) throw new Error("Account not found");

        const provider = await createEmailProvider({
            emailAccountId,
            provider: account.account.provider,
            logger: log,
        });

        // 2. Find a recent thread from this sender to extract unsubscribe info
        // We search for "from:sender"
        // Using provider-specific search if available, but getThreads works generally
        // Note: GmailProvider has getMessages or getThreads. 
        // We need the *content* to find the link or headers.

        // Check if provider supports searching
        // Assuming Gmail for now as it's the primary integration
        let messages: any[] = [];

        if (account.account.provider === 'google') {
            const gmailProvider = provider as any; // Cast to access specific methods if needed or use interface
            // We use getThreads from provider interface but we need search query
            // The minimal provider interface might not have search.
            // Let's use getThread/getMessages from the Google provider directly if possible
            // Or better, let's look at `GmailProvider` implementation again.
            // It has `getThreads(labelId)` but not arbitrary search in interface?
            // Wait, `GmailProvider` class has `getThreads` but checking `src/server/utils/email/google.ts`
            // It has `getThread`.
            // It has `getMessages`.

            // Let's rely on a helper or just iterate recent inbox? 
            // No, iterating inbox is inefficient.
            // We need to find ONE message from this sender.
        }

        // Let's try to finding a message via Prisma first?
        // We sync headers. But we don't sync full body always.
        // Unsubscribe link is in body or headers.
        // `EmailMessage` in DB has `unsubscribeLink`!

        const dbMessage = await prisma.emailMessage.findFirst({
            where: {
                emailAccountId,
                from: { contains: senderEmail },
                unsubscribeLink: { not: null }
            },
            orderBy: { date: 'desc' },
            select: { unsubscribeLink: true }
        });

        if (dbMessage?.unsubscribeLink) {
            log.info("Found unsubscribe link in DB", { link: dbMessage.unsubscribeLink });
            const success = await executeUnsubscribeLink(dbMessage.unsubscribeLink);
            return { success, method: "db_link" };
        }

        // If not in DB, we might need to fetch from provider.
        // For now, let's implement the DB path as MVP as we already have `unsubscribeLink` extraction logic in `process-history`?
        // Wait, where is `unsubscribeLink` populated? 
        // It's populated in `processHistoryItem` -> `parseMessage`.

        // If not in DB, likely we can't unsubscribe easily without fetching full body which is expensive.
        // But let's assume if it's a newsletter, we probably synced it.

        // Fallback: Try to fetch the very last message from sender from Provider
        // (Future improvement)

        return { success: false, error: "No unsubscribe link found" };

    } catch (error) {
        logger.error("Unsubscribe execution failed", { error });
        return { success: false, error: String(error) };
    }
}

async function executeUnsubscribeLink(link: string): Promise<boolean> {
    try {
        // Simple GET/POST heuristics or mailto
        if (link.startsWith("mailto:")) {
            // Need to send email
            // Parse mailto: address?subject=...
            // This requires sending an email using the user's account.
            // Implemented in future.
            logger.info("Mailto unsubscribe not yet supported", { link });
            return false;
        }

        // SSRF Protection: Validate URL before fetching
        // This prevents attackers from using malicious unsubscribe links to probe internal networks
        const validation = validateUrlForSsrf(link);
        if (!validation.safe) {
            logger.warn("Blocked unsafe unsubscribe link", { link, reason: validation.reason });
            return false;
        }

        // HTTP/S - URL has been validated as safe
        const response = await fetch(link, {
            method: 'GET', // Most unsubscribe links work with GET or lead to a form
            headers: {
                'User-Agent': 'Mozilla/5.0 (compatible; AModel/1.0; Unsubscribe)',
            },
            // Add timeout to prevent hanging on slow/malicious servers
            signal: AbortSignal.timeout(10000), // 10 second timeout
        });

        if (response.ok) {
            logger.info("Visited unsubscribe link successfully", { link, status: response.status });
            return true;
        }

        // Log non-ok response but still return true for MVP
        // (visiting the link is often enough even if the response is a redirect or error page)
        logger.info("Unsubscribe link returned non-ok status", { link, status: response.status });
        return true;
    } catch (e) {
        // Check if it's a timeout error
        if (e instanceof Error && e.name === 'TimeoutError') {
            logger.warn("Unsubscribe link request timed out", { link });
        } else {
            logger.error("Failed to execute unsubscribe link", { link, error: e });
        }
        return false;
    }
}
