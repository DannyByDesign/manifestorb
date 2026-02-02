
import { type Logger } from "@/server/lib/logger";
import { type ParsedMessage } from "@/server/types";
import { createEmailProvider as createServiceEmailProvider } from "@/features/email/provider";
import { type EmailProvider as ServiceEmailProvider, type EmailThread, type Contact } from "@/features/email/types";

// Basic Types (kept for compatibility with index.ts)
export interface EmailAccount {
    id: string;
    provider: string;
    access_token: string | null;
    refresh_token: string | null;
    expires_at: number | null;
    email: string;
}

export interface EmailChanges {
    archive?: boolean;
    trash?: boolean;
    read?: boolean;
    labels?: {
        add?: string[];
        remove?: string[];
    };
    unsubscribe?: boolean;
    tracking?: boolean;
    followUp?: "enable" | "disable";
    bulk_archive_senders?: boolean;
    bulk_trash_senders?: boolean;
    bulk_label_senders?: string;
    targetFolderId?: string; // For Drive/Move
}

export interface DraftParams {
    type: "new" | "reply" | "forward";
    parentId?: string; // threadId for reply/forward
    to?: string[];
    cc?: string[];
    bcc?: string[];
    subject?: string;
    body?: string; // HTML
}

// Tool-Specific Interface (Adapter)
export interface EmailProvider {
    // Core (Original)
    search(query: string, limit: number): Promise<ParsedMessage[]>;
    get(ids: string[]): Promise<ParsedMessage[]>;
    modify(ids: string[], changes: EmailChanges): Promise<{ success: boolean; count: number; data?: any }>;
    createDraft(params: DraftParams): Promise<{ draftId: string; preview: any }>;
    trash(ids: string[]): Promise<{ success: boolean; count: number }>;

    // Extended (Found missing during audit)
    getThread(threadId: string): Promise<EmailThread>;
    searchContacts(query: string): Promise<Contact[]>;
    createContact(contact: Partial<Contact>): Promise<Contact>;
}

export async function createEmailProvider(
    account: EmailAccount,
    logger: Logger
): Promise<EmailProvider> {

    // Initialize the heavyweight Service Provider
    const service: ServiceEmailProvider = await createServiceEmailProvider({
        emailAccountId: account.id,
        provider: account.provider,
        logger
    });

    return {
        search: async (query: string, limit: number) => {
            const res = await service.getMessagesWithPagination({
                query,
                maxResults: limit
            });
            return res.messages;
        },

        get: async (ids: string[]) => {
            return await service.getMessagesBatch(ids);
        },

        modify: async (ids: string[], changes: EmailChanges) => {
            let count = 0;

            // Fetch messages upfront to get thread IDs for thread-level operations
            // (archiveThread, trashThread, markReadThread all require thread IDs, not message IDs)
            const messages = await service.getMessagesBatch(ids);
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
                        await service.trashThread(threadId, account.email, "automation");
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
            let draftId = "";

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

            return {
                draftId,
                preview: {
                    to: params.to,
                    subject: params.subject,
                    bodySnippet: params.body?.slice(0, 100)
                }
            };
        },

        trash: async (ids: string[]) => {
            const messages = await service.getMessagesBatch(ids);
            const threadIds = [...new Set(messages.map(m => m.threadId))];

            let count = 0;
            await Promise.all(threadIds.map(async (tid) => {
                await service.trashThread(tid, account.email, "automation");
                count++;
            }));
            return { success: true, count };
        },

        // Extended
        getThread: async (threadId: string) => {
            return await service.getThread(threadId);
        },

        searchContacts: async (query: string) => {
            return await service.searchContacts(query);
        },

        createContact: async (contact: Partial<Contact>) => {
            return await service.createContact(contact);
        }
    };
}
