
import { type Logger } from "@/server/lib/logger";
import { type ParsedMessage } from "@/server/types";
import { createEmailProvider as createServiceEmailProvider } from "@/features/email/provider";
import { type EmailProvider as ServiceEmailProvider, type EmailThread, type Contact } from "@/features/email/types";
import { SafeError } from "@/server/lib/error";
import {
    type DraftParams,
    type EmailChanges,
    type ToolEmailAccount,
} from "./types";

const GMAIL_RECONNECT_MESSAGE =
    "Your Gmail connection is not active. Please reconnect your email in the Amodel web app (Settings -> Accounts) to use email features from Slack.";

function isGmailAuthError(err: unknown): boolean {
    if (err instanceof SafeError) {
        const msg = err.message ?? "";
        return msg === "No refresh token" || msg.includes("Gmail connection has expired");
    }
    if (err instanceof Error) {
        return err.message.includes("invalid_grant") || err.message.includes("No refresh token") || err.message.includes("Gmail connection has expired");
    }
    return false;
}

// Tool-Specific Interface (Adapter)
export interface EmailProvider {
    // Core (Original)
    search(options: {
        query: string;
        limit?: number;
        fetchAll?: boolean;
        pageToken?: string;
        before?: Date;
        after?: Date;
        subjectContains?: string;
        bodyContains?: string;
        text?: string;
        from?: string;
        to?: string;
        hasAttachment?: boolean;
    }): Promise<{
        messages: ParsedMessage[];
        nextPageToken?: string;
        totalEstimate?: number;
    }>;
    get(ids: string[]): Promise<ParsedMessage[]>;
    modify(ids: string[], changes: EmailChanges): Promise<{ success: boolean; count: number; data?: unknown }>;
    createDraft(params: DraftParams): Promise<{ draftId: string; preview: unknown }>;
    trash(ids: string[]): Promise<{ success: boolean; count: number }>;
    sendDraft(draftId: string): Promise<{ messageId: string; threadId: string }>;
    getDrafts(options?: { maxResults?: number }): Promise<ParsedMessage[]>;
    getDraft(draftId: string): Promise<ParsedMessage | null>;
    updateDraft(
        draftId: string,
        params: {
            messageHtml?: string;
            subject?: string;
        },
    ): Promise<void>;
    deleteDraft(draftId: string): Promise<void>;

    // Extended (Found missing during audit)
    getThread(threadId: string): Promise<EmailThread>;
    searchContacts(query: string): Promise<Contact[]>;
    createContact(contact: Partial<Contact>): Promise<Contact>;
}

export async function createEmailProvider(
    account: ToolEmailAccount,
    logger: Logger
): Promise<EmailProvider> {

    // Initialize the heavyweight Service Provider
    const service: ServiceEmailProvider = await createServiceEmailProvider({
        emailAccountId: account.id,
        provider: account.provider,
        logger
    });

    const normalizeText = (value: string | undefined): string => value?.trim().toLowerCase() ?? "";

    const includesTerm = (value: string | undefined, term: string | undefined): boolean => {
        const normalizedTerm = normalizeText(term);
        if (!normalizedTerm) return true;
        return normalizeText(value).includes(normalizedTerm);
    };

    const applyLocalSearchFilters = (
        messages: ParsedMessage[],
        options: {
            subjectContains?: string;
            bodyContains?: string;
            text?: string;
            from?: string;
            to?: string;
            hasAttachment?: boolean;
        },
    ): ParsedMessage[] => {
        const shouldCheckText = normalizeText(options.text).length > 0;

        return messages.filter((message) => {
            const subject = message.subject || message.headers?.subject || "";
            const body = message.textPlain || message.snippet || "";
            const from = message.headers?.from || "";
            const to = message.headers?.to || "";

            if (!includesTerm(subject, options.subjectContains)) return false;
            if (!includesTerm(body, options.bodyContains)) return false;
            if (!includesTerm(from, options.from)) return false;
            if (!includesTerm(to, options.to)) return false;

            if (options.hasAttachment !== undefined) {
                const hasAttachment = Array.isArray(message.attachments) && message.attachments.length > 0;
                if (options.hasAttachment !== hasAttachment) return false;
            }

            if (shouldCheckText) {
                const combined = `${subject} ${body} ${from} ${to}`.trim();
                if (!includesTerm(combined, options.text)) return false;
            }

            return true;
        });
    };

    const hasLocalFilter = (options: {
        subjectContains?: string;
        bodyContains?: string;
        text?: string;
        from?: string;
        to?: string;
        hasAttachment?: boolean;
    }): boolean =>
        Boolean(
            normalizeText(options.subjectContains) ||
            normalizeText(options.bodyContains) ||
            normalizeText(options.text) ||
            normalizeText(options.from) ||
            normalizeText(options.to) ||
            options.hasAttachment !== undefined,
        );

    const runWithConcurrency = async <T>(
        items: T[],
        concurrency: number,
        worker: (item: T) => Promise<void>,
    ) => {
        if (items.length === 0) return;
        const safeConcurrency = Math.max(1, concurrency);
        for (let i = 0; i < items.length; i += safeConcurrency) {
            const slice = items.slice(i, i + safeConcurrency);
            await Promise.all(slice.map((item) => worker(item)));
        }
    };

    return {
        search: async ({ query, limit, fetchAll, pageToken, before, after, subjectContains, bodyContains, text, from, to, hasAttachment }) => {
            try {
                const localFilterOptions = {
                    subjectContains,
                    bodyContains,
                    text,
                    from,
                    to,
                    hasAttachment,
                };

                if (!hasLocalFilter(localFilterOptions)) {
                    return await service.getMessagesWithPagination({
                        query,
                        maxResults: limit,
                        pageToken,
                        before,
                        after,
                        fetchAll,
                    });
                }

                const targetCount = fetchAll ? (limit ?? 500) : (limit ?? 100);
                const pageSize = Math.min(Math.max(targetCount, 20), 100);
                const filtered: ParsedMessage[] = [];
                let nextPageToken: string | undefined = pageToken;
                let totalEstimate: number | undefined;

                do {
                    const res = await service.getMessagesWithPagination({
                        query,
                        maxResults: pageSize,
                        pageToken: nextPageToken,
                        before,
                        after,
                        fetchAll: false,
                    });

                    if (totalEstimate === undefined) {
                        totalEstimate = res.totalEstimate;
                    }

                    const batch = applyLocalSearchFilters(res.messages, localFilterOptions);
                    filtered.push(...batch);
                    nextPageToken = res.nextPageToken;
                } while (nextPageToken && filtered.length < targetCount);

                return {
                    messages: filtered.slice(0, targetCount),
                    nextPageToken,
                    totalEstimate,
                };
            } catch (err: unknown) {
                if (isGmailAuthError(err)) {
                    throw new Error(GMAIL_RECONNECT_MESSAGE);
                }
                const detail = err instanceof Error ? err.message : JSON.stringify(err);
                throw new Error(`Gmail search failed (query="${query}"): ${detail}`);
            }
        },

        get: async (ids: string[]) => {
            try {
                return await service.getMessagesBatch(ids);
            } catch (err: unknown) {
                if (isGmailAuthError(err)) {
                    throw new Error(GMAIL_RECONNECT_MESSAGE);
                }
                throw err;
            }
        },

        modify: async (ids: string[], changes: EmailChanges) => {
            let count = 0;

            let messages: ParsedMessage[];
            try {
                messages = await service.getMessagesBatch(ids);
            } catch (err: unknown) {
                if (isGmailAuthError(err)) {
                    throw new Error(GMAIL_RECONNECT_MESSAGE);
                }
                throw err;
            }
            const messageToThread = new Map(messages.map(m => [m.id, m.threadId]));

            // Track which threads we've already processed to avoid duplicate operations
            const processedThreads = new Set<string>();

            await Promise.all(ids.map(async (id) => {
                try {
                    const threadId = messageToThread.get(id);
                    if (!threadId) {
                        logger.warn("Could not find thread ID for message", { messageId: id });
                        return;
                    }

                    // Archive (thread-level operation)
                    if (changes.archive && !processedThreads.has(`archive:${threadId}`)) {
                        await service.archiveThread(threadId, account.email);
                        processedThreads.add(`archive:${threadId}`);
                    }

                    // Trash (thread-level operation)
                    if (changes.trash && !processedThreads.has(`trash:${threadId}`)) {
                        await service.trashThread(threadId, account.email, "ai");
                        processedThreads.add(`trash:${threadId}`);
                    }

                    // Read/Unread (thread-level operation)
                    if (changes.read !== undefined && !processedThreads.has(`read:${threadId}`)) {
                        await service.markReadThread(threadId, changes.read);
                        processedThreads.add(`read:${threadId}`);
                    }

                    // Labels
                    if (changes.labels) {
                        const { add, remove } = changes.labels;
                        // Adding labels works on message IDs
                        if (add) {
                            for (const labelId of add) {
                                await service.labelMessage({ messageId: id, labelId, labelName: null });
                            }
                        }
                        // Removing labels is a thread-level operation
                        if (remove && remove.length > 0 && !processedThreads.has(`removeLabels:${threadId}`)) {
                            await service.removeThreadLabels(threadId, remove);
                            processedThreads.add(`removeLabels:${threadId}`);
                        }
                    }
                    count++;
                } catch (e) {
                    logger.error("Failed to modify item", { id, error: e });
                }
            }));

            return { success: true, count };
        },

        createDraft: async (params: DraftParams) => {
            // Validate: reply/forward need a parentId (thread/message to reply to)
            if ((params.type === "reply" || params.type === "forward") && !params.parentId) {
                throw new Error(
                    `Cannot create ${params.type} draft without parentId. ` +
                    `Search for the email first using the query tool (resource: "email") to get the thread ID, then pass it as parentId.`
                );
            }

            let draftId = "";
            try {
            if (params.type === "new") {
                const res = await service.createDraft({
                    to: params.to?.join(", ") || "",
                    subject: params.subject || "",
                    messageHtml: params.body || "",
                });
                draftId = res.id;
            } else if (params.type === "reply" && params.parentId) {
                const res = await service.createDraft({
                    to: params.to?.join(", ") || "",
                    subject: params.subject || "",
                    messageHtml: params.body || "",
                    replyToMessageId: params.parentId
                });
                draftId = res.id;
            } else if (params.type === "forward" && params.parentId) {
                const res = await service.createDraft({
                    to: params.to?.join(", ") || "",
                    subject: params.subject || "",
                    messageHtml: params.body || "",
                });
                draftId = res.id;
            }

            if (!draftId) {
                throw new Error(`Draft creation returned no ID. type=${params.type}, parentId=${params.parentId ?? "none"}`);
            }

            return {
                draftId,
                preview: {
                    to: params.to,
                    subject: params.subject,
                    bodySnippet: params.body?.slice(0, 100)
                }
            };
            } catch (err: unknown) {
                if (isGmailAuthError(err)) {
                    throw new Error(GMAIL_RECONNECT_MESSAGE);
                }
                throw err;
            }
        },

        trash: async (ids: string[]) => {
            try {
            const messages = await service.getMessagesBatch(ids);
            const threadIds = [...new Set(messages.map(m => m.threadId))];

            let count = 0;
            await runWithConcurrency(threadIds, 5, async (tid) => {
                await service.trashThread(tid, account.email, "ai");
                count++;
            });
            return { success: true, count };
            } catch (err: unknown) {
                if (isGmailAuthError(err)) {
                    throw new Error(GMAIL_RECONNECT_MESSAGE);
                }
                throw err;
            }
        },

        sendDraft: async (draftId: string) => {
            try {
                return await service.sendDraft(draftId);
            } catch (err: unknown) {
                if (isGmailAuthError(err)) {
                    throw new Error(GMAIL_RECONNECT_MESSAGE);
                }
                throw err;
            }
        },

        getDrafts: async (options?: { maxResults?: number }) => {
            try {
                return await service.getDrafts(options);
            } catch (err: unknown) {
                if (isGmailAuthError(err)) {
                    throw new Error(GMAIL_RECONNECT_MESSAGE);
                }
                throw err;
            }
        },

        getDraft: async (draftId: string) => {
            try {
                return await service.getDraft(draftId);
            } catch (err: unknown) {
                if (isGmailAuthError(err)) {
                    throw new Error(GMAIL_RECONNECT_MESSAGE);
                }
                throw err;
            }
        },

        updateDraft: async (
            draftId: string,
            params: {
                messageHtml?: string;
                subject?: string;
            },
        ) => {
            try {
                await service.updateDraft(draftId, params);
            } catch (err: unknown) {
                if (isGmailAuthError(err)) {
                    throw new Error(GMAIL_RECONNECT_MESSAGE);
                }
                throw err;
            }
        },

        deleteDraft: async (draftId: string) => {
            try {
                await service.deleteDraft(draftId);
            } catch (err: unknown) {
                if (isGmailAuthError(err)) {
                    throw new Error(GMAIL_RECONNECT_MESSAGE);
                }
                throw err;
            }
        },

        // Extended
        getThread: async (threadId: string) => {
            try {
                return await service.getThread(threadId);
            } catch (err: unknown) {
                if (isGmailAuthError(err)) {
                    throw new Error(GMAIL_RECONNECT_MESSAGE);
                }
                throw err;
            }
        },

        searchContacts: async (query: string) => {
            try {
                return await service.searchContacts(query);
            } catch (err: unknown) {
                if (isGmailAuthError(err)) {
                    throw new Error(GMAIL_RECONNECT_MESSAGE);
                }
                throw err;
            }
        },

        createContact: async (contact: Partial<Contact>) => {
            try {
                return await service.createContact(contact);
            } catch (err: unknown) {
                if (isGmailAuthError(err)) {
                    throw new Error(GMAIL_RECONNECT_MESSAGE);
                }
                throw err;
            }
        }
    };
}
