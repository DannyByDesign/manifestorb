
import { type gmail_v1 } from "@googleapis/gmail";
import { type OutlookClient, getOutlookClientWithRefresh } from "@/server/integrations/microsoft/client";
import { getGmailClientWithRefresh } from "@/server/integrations/google/client";
import { queryBatchMessages as queryGmailMessages, getMessagesBatch as getGmailMessagesBatch } from "@/server/integrations/google/message";
import { queryBatchMessages as queryOutlookMessages, getMessage as getOutlookMessage } from "@/server/integrations/microsoft/message";
import { archiveThread, labelThread, markReadThread, GmailLabel } from "@/server/integrations/google/label";
import { trashThread } from "@/server/integrations/google/trash";
import { draftEmail as draftGmailReply } from "@/server/integrations/google/mail";
import { type ParsedMessage } from "@/server/types";
import { type Logger } from "@/server/utils/logger";
import MailComposer from "nodemailer/lib/mail-composer";
import { type Attachment } from "nodemailer/lib/mailer";

// Basic Types
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

export interface EmailProvider {
    search(query: string, limit: number): Promise<ParsedMessage[]>;
    get(ids: string[]): Promise<ParsedMessage[]>;
    modify(ids: string[], changes: EmailChanges): Promise<{ success: boolean; count: number }>;
    createDraft(params: DraftParams): Promise<{ draftId: string; preview: any }>;
    trash(ids: string[]): Promise<{ success: boolean; count: number }>;
}

export async function createEmailProvider(
    account: EmailAccount,
    logger: Logger
): Promise<EmailProvider> {
    if (account.provider === "google") {
        const client = await getGmailClientWithRefresh({
            accessToken: account.access_token,
            refreshToken: account.refresh_token,
            expiresAt: account.expires_at ? account.expires_at * 1000 : null,
            emailAccountId: account.id,
            logger,
        });
        return createGmailProvider(client, account.email, logger);
    } else if (account.provider === "microsoft") {
        const client = await getOutlookClientWithRefresh({
            accessToken: account.access_token,
            refreshToken: account.refresh_token,
            expiresAt: account.expires_at ? account.expires_at * 1000 : null,
            emailAccountId: account.id,
            logger,
        });
        return createOutlookProvider(client, account.email, logger);
    } else {
        throw new Error(`Unsupported provider: ${account.provider}`);
    }
}

// ==========================================
// GMAIL IMPLEMENTATION
// ==========================================

function createGmailProvider(client: gmail_v1.Gmail, userEmail: string, logger: Logger): EmailProvider {

    // Helper to create raw email for new drafts
    const createRawDraft = async (params: DraftParams) => {
        const mailComposer = new MailComposer({
            to: params.to?.join(", "),
            cc: params.cc?.join(", "),
            bcc: params.bcc?.join(", "),
            subject: params.subject,
            html: params.body,
        });
        const message = await mailComposer.compile().build();
        return Buffer.from(message).toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
    };

    return {
        search: async (query: string, limit: number) => {
            const result = await queryGmailMessages(client, {
                query,
                maxResults: limit,
            });
            return result.messages as ParsedMessage[];
        },

        get: async (ids: string[]) => {
            // getMessagesBatch requires accessToken. We can get it from client context but it's hacking properties.
            // Better to use getMessage one by one or fix getMessagesBatch signature.
            // queryBatchMessages uses getAccessTokenFromClient(gmail).
            // parsedMessage is returned by queryGmailMessages, so we can reuse that logic if we assume IDs are thread IDs or message IDs.
            // Actually `getMessagesBatch` takes an accessToken.
            // We can extract it from the client object as done in `client.ts`
            const accessToken = (client.context._options.auth as any).credentials.access_token;
            return await getGmailMessagesBatch({ messageIds: ids, accessToken });
        },

        modify: async (ids: string[], changes: EmailChanges) => {
            // Gmail operations are per-thread usually or per-message.
            // We'll assume IDs are THREAD IDs for modify operations like archive/label for consistency with UI.
            // If they are message IDs, some calls might fail or need message-specific endpoints. 
            // `queryGmailMessages` returns objects with `id` and `threadId`. 
            // Let's assume input IDs are Thread IDs for now as that's safe for Archive/Label.

            let count = 0;
            await Promise.all(ids.map(async (id) => {
                try {
                    if (changes.archive) {
                        await archiveThread({ gmail: client, threadId: id, ownerEmail: userEmail, actionSource: "automation" });
                    }
                    if (changes.trash) {
                        await trashThread({ gmail: client, threadId: id, ownerEmail: userEmail, actionSource: "automation" });
                    }
                    if (changes.read !== undefined) {
                        await markReadThread({ gmail: client, threadId: id, read: changes.read });
                    }
                    if (changes.labels) {
                        if (changes.labels.add || changes.labels.remove) {
                            await labelThread({
                                gmail: client,
                                threadId: id,
                                addLabelIds: changes.labels.add,
                                removeLabelIds: changes.labels.remove
                            });
                        }
                    }
                    count++;
                } catch (e) {
                    logger.error("Failed to modify thread", { id, error: e });
                }
            }));
            return { success: true, count };
        },

        createDraft: async (params: DraftParams) => {
            let draftId = "";

            if (params.type === "new") {
                const raw = await createRawDraft(params);
                const res = await client.users.drafts.create({
                    userId: "me",
                    requestBody: {
                        message: { raw }
                    }
                });
                draftId = res.data.id || "";
            } else if (params.type === "reply" && params.parentId) {
                // We need the original message to reply to.
                // parentId is assumed to be Thread ID or Message ID.
                // draftGmailReply needs an EmailForAction object.
                // We need to fetch the last message in the thread or the specific message.
                // simplified: just use the raw creation for now to avoid dependency hell, 
                // OR fetch the message first.
                // Let's fetch the message to respect threading.
                const accessToken = (client.context._options.auth as any).credentials.access_token;
                const messages = await getGmailMessagesBatch({ messageIds: [params.parentId], accessToken });
                if (messages.length > 0) {
                    const original = messages[0];
                    // draftGmailReply expects EmailForAction which is compatible with ParsedMessage mostly
                    // But strictly it might differ.
                    // Let's manually create the raw reply to ensure control.
                    // Actually, reusing `draftGmailReply` is best.
                    // We need to support `attachments` in params? Tool definition handles basic text.
                    // ignoring attachments in 'reply' tool params for now.
                    const res = await draftGmailReply(client, original as any, {
                        content: params.body || "",
                        to: params.to?.[0], // simple reply
                        subject: params.subject,
                        cc: params.cc?.[0],
                        bcc: params.bcc?.[0],
                    }, userEmail);
                    draftId = res.data.id || "";
                }
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
            let count = 0;
            await Promise.all(ids.map(async (id) => {
                await trashThread({ gmail: client, threadId: id, ownerEmail: userEmail, actionSource: "automation" });
                count++;
            }));
            return { success: true, count };
        }
    };
}

// ==========================================
// OUTLOOK IMPLEMENTATION
// ==========================================

function createOutlookProvider(client: OutlookClient, userEmail: string, logger: Logger): EmailProvider {
    return {
        search: async (query: string, limit: number) => {
            const result = await queryOutlookMessages(client, {
                searchQuery: query,
                maxResults: limit,
            }, logger);
            return result.messages;
        },

        get: async (ids: string[]) => {
            const messages = await Promise.all(ids.map(id => getOutlookMessage(id, client, logger)));
            return messages;
        },

        modify: async (ids: string[], changes: EmailChanges) => {
            let count = 0;
            const graphClient = client.getClient();

            await Promise.all(ids.map(async (id) => {
                try {
                    const update: any = {};

                    if (changes.read !== undefined) {
                        update.isRead = changes.read;
                    }

                    // Categories (Labels)
                    if (changes.labels) {
                        // Fetch existing categories first to append/remove
                        const msg = await getOutlookMessage(id, client, logger);
                        let categories = msg.labelIds || []; // labelIds in ParsedMessage map to categories in Outlook

                        if (changes.labels.add) {
                            categories = [...categories, ...changes.labels.add];
                        }
                        if (changes.labels.remove) {
                            categories = categories.filter(c => !changes.labels?.remove?.includes(c));
                        }
                        update.categories = [...new Set(categories)];
                    }

                    if (Object.keys(update).length > 0) {
                        await graphClient.api(`/me/messages/${id}`).patch(update);
                    }

                    // Move operations (Archive / Trash)
                    if (changes.archive) {
                        // Move to Archive folder
                        // Need to find Archive folder ID. 
                        // We can just use "archive" well-known name? 
                        // microsoft/message.ts implementation indicates we need folder ID.
                        // The client caches folder IDs.
                        const folderIds = client.getFolderIdCache();
                        if (folderIds?.archive) {
                            await graphClient.api(`/me/messages/${id}/move`).post({ destinationId: folderIds.archive });
                        }
                    }

                    if (changes.trash) {
                        // Move to Deleted Items
                        const folderIds = client.getFolderIdCache();
                        if (folderIds?.deleteditems) {
                            await graphClient.api(`/me/messages/${id}/move`).post({ destinationId: folderIds.deleteditems });
                        }
                    }

                    count++;
                } catch (e) {
                    logger.error("Failed to modify outlook message", { id, error: e });
                }
            }));
            return { success: true, count };
        },

        createDraft: async (params: DraftParams) => {
            const graphClient = client.getClient();
            let draftId = "";

            const messageBody = {
                subject: params.subject,
                body: {
                    contentType: "HTML",
                    content: params.body
                },
                toRecipients: params.to?.map(email => ({ emailAddress: { address: email } })),
                ccRecipients: params.cc?.map(email => ({ emailAddress: { address: email } })),
                bccRecipients: params.bcc?.map(email => ({ emailAddress: { address: email } }))
            };

            if (params.type === "new") {
                const res = await graphClient.api("/me/messages").post(messageBody);
                draftId = res.id;
            } else if (params.type === "reply" && params.parentId) {
                // Create Reply Draft
                // Microsoft Graph createReply / createReplyAll
                // Then patch body.
                const res = await graphClient.api(`/me/messages/${params.parentId}/createReply`).post({});
                draftId = res.id;

                // Patch the body
                await graphClient.api(`/me/messages/${draftId}`).patch(messageBody);
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
            // Move to deleted items
            const graphClient = client.getClient();
            let count = 0;
            await Promise.all(ids.map(async (id) => {
                // We could use /move to deleted items or DELETE method (soft delete)
                // DELETE method moves to deleted items usually.
                await graphClient.api(`/me/messages/${id}`).delete();
                count++;
            }));
            return { success: true, count };
        }
    };
}
