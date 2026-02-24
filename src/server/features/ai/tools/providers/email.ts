
import { type Logger } from "@/server/lib/logger";
import { type ParsedMessage } from "@/server/types";
import { createEmailProvider as createServiceEmailProvider } from "@/features/email/provider";
import {
    type EmailProvider as ServiceEmailProvider,
    type EmailThread,
    type Contact,
    type EmailFilter,
} from "@/features/email/types";
import { SafeError } from "@/server/lib/error";
import { runInBatches } from "@/server/features/ai/tools/common/concurrency";
import { createOperationIdempotencyToken } from "@/server/features/ai/tools/common/idempotency";
import {
    isProviderRateLimitError,
    withRetries,
} from "@/server/features/ai/tools/common/retry";
import { withToolThrottle } from "@/server/features/ai/tools/common/throttle";
import { extractEmailAddress } from "@/server/lib/email";
import {
    type DraftParams,
    type EmailChanges,
    type ToolEmailAccount,
} from "./types";

const GMAIL_RECONNECT_MESSAGE =
    "Your Gmail connection is not active. Please reconnect your email in the Amodel web app (Settings -> Accounts) to use email features from Slack.";
const SEARCH_TOTAL_TIMEOUT_MS = 25_000;
const SEARCH_TOTAL_TIMEOUT_MAX_MS = 90_000;
const SEARCH_PAGE_TIMEOUT_MS = 15_000;
const SEARCH_PAGE_TIMEOUT_FETCH_ALL_MS = 20_000;
const SEARCH_PAGE_SIZE_MIN = 10;
const SEARCH_PAGE_SIZE_MAX = 100;
const LOCAL_FILTER_MAX_PAGES_DEFAULT = 8;
const LOCAL_FILTER_MAX_PAGES_FETCH_ALL_DEFAULT = 16;
const LOCAL_FILTER_MAX_SCANNED_MESSAGES_DEFAULT = 600;
const LOCAL_FILTER_MAX_SCANNED_MESSAGES_FETCH_ALL_DEFAULT = 1_200;

function computeSearchTimeoutBudgetMs(options: {
    fetchAll?: boolean;
    limit?: number;
}): number {
    const base = SEARCH_TOTAL_TIMEOUT_MS;
    const fetchAllBonus = options.fetchAll ? 35_000 : 0;
    const largeLimitBonus =
        typeof options.limit === "number" && options.limit > 200 ? 20_000 : 0;
    return Math.min(base + fetchAllBonus + largeLimitBonus, SEARCH_TOTAL_TIMEOUT_MAX_MS);
}

function computeSearchPageTimeoutMs(fetchAll: boolean): number {
    return fetchAll ? SEARCH_PAGE_TIMEOUT_FETCH_ALL_MS : SEARCH_PAGE_TIMEOUT_MS;
}

function resolveGuardrailInt(params: {
    envName: string;
    fallback: number;
    min: number;
    max: number;
}): number {
    const raw = process.env[params.envName];
    if (typeof raw !== "string" || raw.trim().length === 0) return params.fallback;
    const parsed = Number.parseInt(raw, 10);
    if (!Number.isFinite(parsed)) return params.fallback;
    return Math.min(Math.max(parsed, params.min), params.max);
}

class EmailOperationTimeoutError extends Error {
    constructor(operation: string, timeoutMs: number) {
        super(`email_operation_timeout:${operation}:${timeoutMs}`);
        this.name = "EmailOperationTimeoutError";
    }
}

async function withEmailOperationTimeout<T>(
    operation: string,
    timeoutMs: number,
    run: () => Promise<T>,
): Promise<T> {
    let timeoutHandle: ReturnType<typeof setTimeout> | undefined;
    try {
        return await Promise.race([
            run(),
            new Promise<T>((_resolve, reject) => {
                timeoutHandle = setTimeout(() => {
                    reject(new EmailOperationTimeoutError(operation, timeoutMs));
                }, timeoutMs);
            }),
        ]);
    } finally {
        if (timeoutHandle) clearTimeout(timeoutHandle);
    }
}

function remainingSearchBudget(deadlineMs: number): number {
    return deadlineMs - Date.now();
}

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
    readonly name: "google" | "microsoft";
    // Core (Original)
    getUnreadCount(options?: { scope?: "inbox" | "primary" | "all" }): Promise<{
        count: number;
        exact: boolean;
    }>;
    search(options: {
        query: string;
        limit?: number;
        fetchAll?: boolean;
        pageToken?: string;
        includeNonPrimary?: boolean;
        before?: Date;
        after?: Date;
        subjectContains?: string;
        bodyContains?: string;
        text?: string;
        from?: string;
        to?: string;
        cc?: string;
        fromEmails?: string[];
        fromDomains?: string[];
        toEmails?: string[];
        toDomains?: string[];
        ccEmails?: string[];
        ccDomains?: string[];
        category?: "primary" | "promotions" | "social" | "updates" | "forums";
        hasAttachment?: boolean;
        attachmentIntentTerm?: string;
        attachmentMimeTypes?: string[];
        attachmentFilenameContains?: string;
        sentByMe?: boolean;
        receivedByMe?: boolean;
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
    markSpam(threadId: string): Promise<void>;
    blockUnsubscribedEmail(messageId: string): Promise<void>;
    getFiltersList(): Promise<EmailFilter[]>;
    createFilter(options: {
        from: string;
        addLabelIds?: string[];
        removeLabelIds?: string[];
    }): Promise<{ status: number }>;
    deleteFilter(id: string): Promise<{ status: number }>;
    createAutoArchiveFilter(options: {
        from: string;
        gmailLabelId?: string;
        labelName?: string;
    }): Promise<{ status: number }>;
    moveThreadToFolder(threadId: string, folderName: string): Promise<void>;

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

    const tokenize = (value: string | undefined): string[] =>
        normalizeText(value)
            .split(/[^a-z0-9@._-]+/u)
            .filter((token) => token.length > 0);

    const normalizeToken = (token: string): string => token.replace(/[^a-z0-9]/gu, "");

    const extractCandidateTokens = (value: string | undefined): string[] => {
        const candidates = new Set<string>();
        for (const token of tokenize(value)) {
            const compact = normalizeToken(token);
            if (compact.length > 0) candidates.add(compact);
            if (!token.includes("@")) continue;

            const [localPart] = token.split("@");
            if (!localPart) continue;
            const normalizedLocal = normalizeToken(localPart);
            if (normalizedLocal.length > 0) candidates.add(normalizedLocal);
            for (const localToken of localPart.split(/[._-]+/u)) {
                const normalizedLocalToken = normalizeToken(localToken);
                if (normalizedLocalToken.length > 0) candidates.add(normalizedLocalToken);
            }
        }
        return Array.from(candidates);
    };

    const boundedEditDistance = (a: string, b: string, maxDistance: number): number => {
        if (a === b) return 0;
        if (!a || !b) return Math.max(a.length, b.length);
        if (Math.abs(a.length - b.length) > maxDistance) return maxDistance + 1;

        let prev = Array.from({ length: b.length + 1 }, (_, idx) => idx);
        for (let i = 1; i <= a.length; i += 1) {
            const current = [i];
            let rowMin = current[0]!;
            for (let j = 1; j <= b.length; j += 1) {
                const cost = a[i - 1] === b[j - 1] ? 0 : 1;
                const value = Math.min(
                    prev[j]! + 1,
                    current[j - 1]! + 1,
                    prev[j - 1]! + cost,
                );
                current.push(value);
                if (value < rowMin) rowMin = value;
            }
            if (rowMin > maxDistance) return maxDistance + 1;
            prev = current;
        }
        return prev[b.length]!;
    };

    const tokensRoughlyMatch = (queryToken: string, valueToken: string): boolean => {
        if (!queryToken || !valueToken) return false;
        if (queryToken === valueToken) return true;

        if (queryToken.length === 1 || valueToken.length === 1) {
            return queryToken[0] === valueToken[0];
        }

        if (queryToken.includes(valueToken) || valueToken.includes(queryToken)) {
            return Math.min(queryToken.length, valueToken.length) >= 3;
        }

        return (
            Math.max(queryToken.length, valueToken.length) >= 5 &&
            boundedEditDistance(queryToken, valueToken, 1) <= 1
        );
    };

    const includesLooseTerm = (value: string | undefined, term: string | undefined): boolean => {
        const normalizedTerm = normalizeText(term);
        if (!normalizedTerm) return true;
        const normalizedValue = normalizeText(value);
        if (!normalizedValue) return false;
        if (normalizedValue.includes(normalizedTerm)) return true;

        const queryTokens = tokenize(normalizedTerm)
            .map((token) => normalizeToken(token))
            .filter((token) => token.length > 0);
        const valueTokens = extractCandidateTokens(normalizedValue);
        if (queryTokens.length === 0 || valueTokens.length === 0) return false;

        if (queryTokens.every((queryToken) => valueTokens.some((valueToken) => tokensRoughlyMatch(queryToken, valueToken)))) {
            return true;
        }

        if (queryTokens.length >= 2) {
            const firstInitial = queryTokens[0]?.[0] ?? "";
            const lastToken = queryTokens[queryTokens.length - 1] ?? "";
            const signature = normalizeToken(`${firstInitial}${lastToken}`);
            if (signature.length > 0) {
                return valueTokens.some((valueToken) => valueToken === signature);
            }
        }

        return false;
    };

    const applyLocalSearchFilters = (
        messages: ParsedMessage[],
        options: {
            subjectContains?: string;
            bodyContains?: string;
            text?: string;
            from?: string;
            to?: string;
            cc?: string;
            fromEmails?: string[];
            fromDomains?: string[];
            toEmails?: string[];
            toDomains?: string[];
            ccEmails?: string[];
            ccDomains?: string[];
            category?: "primary" | "promotions" | "social" | "updates" | "forums";
            hasAttachment?: boolean;
            attachmentIntentTerm?: string;
            attachmentMimeTypes?: string[];
            attachmentFilenameContains?: string;
            sentByMe?: boolean;
            receivedByMe?: boolean;
        },
    ): ParsedMessage[] => {
        const shouldCheckText = normalizeText(options.text).length > 0;
        const attachmentIntentTerm = normalizeText(options.attachmentIntentTerm);
        const normalizedOwnerEmail = normalizeText(account.email);
        const containsOwnerEmail = (value: string | undefined): boolean => {
            const normalized = normalizeText(value);
            if (!normalizedOwnerEmail || !normalized) return false;
            return normalized.includes(normalizedOwnerEmail);
        };

        return messages.filter((message) => {
            const subject = message.subject || message.headers?.subject || "";
            const body = message.textPlain || message.snippet || "";
            const from = message.headers?.from || "";
            const to = message.headers?.to || "";
            const cc = message.headers?.cc || "";
            const bcc = message.headers?.bcc || "";
            const labelIds = Array.isArray(message.labelIds) ? message.labelIds : [];

            if (!includesLooseTerm(subject, options.subjectContains)) return false;
            if (!includesLooseTerm(body, options.bodyContains)) return false;
            if (!includesLooseTerm(from, options.from)) return false;
            if (!includesLooseTerm(to, options.to)) return false;
            if (!includesLooseTerm(cc, options.cc)) return false;

            const normalizedFromAddress = normalizeText(extractEmailAddress(from));
            if (Array.isArray(options.fromEmails) && options.fromEmails.length > 0) {
                const wanted = new Set(options.fromEmails.map((v) => normalizeText(v)));
                if (!normalizedFromAddress || !wanted.has(normalizedFromAddress)) return false;
            }
            if (Array.isArray(options.fromDomains) && options.fromDomains.length > 0) {
                const wanted = options.fromDomains.map((v) => normalizeText(v.replace(/^@/u, "")));
                const domain = normalizedFromAddress.split("@")[1] ?? "";
                if (!domain || !wanted.some((needle) => domain === needle || domain.endsWith(`.${needle}`))) return false;
            }

            if (Array.isArray(options.toEmails) && options.toEmails.length > 0) {
                const wanted = options.toEmails.map((v) => normalizeText(v));
                const normalizedTo = normalizeText(to);
                if (!wanted.some((needle) => normalizedTo.includes(needle))) return false;
            }
            if (Array.isArray(options.toDomains) && options.toDomains.length > 0) {
                const wanted = options.toDomains.map((v) => normalizeText(v.replace(/^@/u, "")));
                const normalizedTo = normalizeText(to);
                if (!wanted.some((needle) => normalizedTo.includes(needle))) return false;
            }
            if (Array.isArray(options.ccEmails) && options.ccEmails.length > 0) {
                const wanted = options.ccEmails.map((v) => normalizeText(v));
                const normalizedCc = normalizeText(cc);
                if (!wanted.some((needle) => normalizedCc.includes(needle))) return false;
            }
            if (Array.isArray(options.ccDomains) && options.ccDomains.length > 0) {
                const wanted = options.ccDomains.map((v) => normalizeText(v.replace(/^@/u, "")));
                const normalizedCc = normalizeText(cc);
                if (!wanted.some((needle) => normalizedCc.includes(needle))) return false;
            }

            if (options.hasAttachment !== undefined) {
                const hasAttachment = Array.isArray(message.attachments) && message.attachments.length > 0;
                if (options.hasAttachment !== hasAttachment) return false;
            }

            if (options.category) {
                const wanted = options.category.toLowerCase();
                const labelSet = new Set(labelIds.map((id) => String(id).toUpperCase()));
                const match = (() => {
                    switch (wanted) {
                        case "primary":
                            return labelSet.has("CATEGORY_PERSONAL");
                        case "promotions":
                            return labelSet.has("CATEGORY_PROMOTIONS");
                        case "social":
                            return labelSet.has("CATEGORY_SOCIAL");
                        case "updates":
                            return labelSet.has("CATEGORY_UPDATES");
                        case "forums":
                            return labelSet.has("CATEGORY_FORUMS");
                        default:
                            return false;
                    }
                })();
                if (!match) return false;
            }

            if (shouldCheckText) {
                const combined = `${subject} ${body} ${from} ${to}`.trim();
                if (!includesLooseTerm(combined, options.text)) return false;
            }

            if (attachmentIntentTerm.length > 0) {
                const attachmentBlob = (message.attachments ?? [])
                    .map((attachment) => `${attachment.filename} ${attachment.mimeType}`)
                    .join(" ");
                const subjectMatches = includesLooseTerm(subject, attachmentIntentTerm);
                const attachmentMatches = includesLooseTerm(attachmentBlob, attachmentIntentTerm);
                // For "<term> attachment" requests, avoid body-only matches that create false positives.
                if (!subjectMatches && !attachmentMatches) return false;
            }

            if (Array.isArray(options.attachmentMimeTypes) && options.attachmentMimeTypes.length > 0) {
                const wanted = options.attachmentMimeTypes
                    .map((value) => normalizeText(value))
                    .filter((value) => value.length > 0);
                if (wanted.length > 0) {
                    const available = (message.attachments ?? [])
                        .map((att) => normalizeText(att.mimeType))
                        .filter((v) => v.length > 0);
                    if (available.length === 0) return false;
                    if (!wanted.some((needle) => available.some((mt) => mt.includes(needle)))) return false;
                }
            }

            if (normalizeText(options.attachmentFilenameContains).length > 0) {
                const needle = normalizeText(options.attachmentFilenameContains);
                const names = (message.attachments ?? []).map((att) => normalizeText(att.filename));
                if (names.length === 0) return false;
                if (!names.some((name) => name.includes(needle))) return false;
            }

            if (options.sentByMe !== undefined) {
                const sentByMe = containsOwnerEmail(from);
                if (sentByMe !== options.sentByMe) return false;
            }

            if (options.receivedByMe !== undefined) {
                const receivedByMe =
                    containsOwnerEmail(to) ||
                    containsOwnerEmail(cc) ||
                    containsOwnerEmail(bcc);
                if (receivedByMe !== options.receivedByMe) return false;
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
        cc?: string;
        fromEmails?: string[];
        fromDomains?: string[];
        toEmails?: string[];
        toDomains?: string[];
        ccEmails?: string[];
        ccDomains?: string[];
        category?: "primary" | "promotions" | "social" | "updates" | "forums";
        hasAttachment?: boolean;
        attachmentIntentTerm?: string;
        attachmentMimeTypes?: string[];
        attachmentFilenameContains?: string;
        sentByMe?: boolean;
        receivedByMe?: boolean;
    }): boolean =>
        Boolean(
            normalizeText(options.subjectContains) ||
            normalizeText(options.bodyContains) ||
            normalizeText(options.text) ||
            normalizeText(options.from) ||
            normalizeText(options.to) ||
            normalizeText(options.cc) ||
            (Array.isArray(options.fromEmails) && options.fromEmails.length > 0) ||
            (Array.isArray(options.fromDomains) && options.fromDomains.length > 0) ||
            (Array.isArray(options.toEmails) && options.toEmails.length > 0) ||
            (Array.isArray(options.toDomains) && options.toDomains.length > 0) ||
            (Array.isArray(options.ccEmails) && options.ccEmails.length > 0) ||
            (Array.isArray(options.ccDomains) && options.ccDomains.length > 0) ||
            normalizeText(options.category) ||
            normalizeText(options.attachmentIntentTerm) ||
            options.hasAttachment !== undefined ||
            (Array.isArray(options.attachmentMimeTypes) && options.attachmentMimeTypes.length > 0) ||
            normalizeText(options.attachmentFilenameContains) ||
            options.sentByMe !== undefined ||
            options.receivedByMe !== undefined,
        );

    const quoteQueryValue = (value: string): string => {
        const trimmed = value.trim();
        if (!trimmed) return "";
        if (/^[^\s"]+$/u.test(trimmed)) return trimmed;
        return `"${trimmed.replace(/"/g, "")}"`;
    };

    const appendQueryToken = (baseQuery: string, token: string | undefined): string => {
        const normalizedToken = token?.trim();
        if (!normalizedToken) return baseQuery.trim();
        const normalizedBase = baseQuery.trim();
        if (!normalizedBase) return normalizedToken;
        if (normalizedBase.toLowerCase().includes(normalizedToken.toLowerCase())) {
            return normalizedBase;
        }
        return `${normalizedBase} ${normalizedToken}`.trim();
    };

    const buildProviderScopedQuery = (params: {
        baseQuery: string;
        filters: {
            subjectContains?: string;
            bodyContains?: string;
            text?: string;
            from?: string;
            to?: string;
            cc?: string;
            fromEmails?: string[];
            fromDomains?: string[];
            toEmails?: string[];
            toDomains?: string[];
            ccEmails?: string[];
            ccDomains?: string[];
            category?: "primary" | "promotions" | "social" | "updates" | "forums";
            hasAttachment?: boolean;
            attachmentIntentTerm?: string;
            sentByMe?: boolean;
            receivedByMe?: boolean;
        };
    }): string => {
        let query = params.baseQuery.trim();
        const { filters } = params;

        const buildOrGroup = (field: "from" | "to" | "cc", values: string[]): string => {
            const cleaned = values
                .map((v) => v.trim())
                .filter((v) => v.length > 0)
                .map((v) => v.replace(/^@/u, ""));
            if (cleaned.length === 0) return "";
            const unique = Array.from(new Set(cleaned));
            if (unique.length === 1) return `${field}:${quoteQueryValue(unique[0]!)}`;
            return `${field}:(${unique.map((v) => quoteQueryValue(v)).join(" OR ")})`;
        };

        const fromGroup = buildOrGroup("from", [
            ...(Array.isArray(filters.fromEmails) ? filters.fromEmails : []),
            ...(Array.isArray(filters.fromDomains) ? filters.fromDomains : []),
        ]);
        if (fromGroup) query = appendQueryToken(query, fromGroup);

        const toGroup = buildOrGroup("to", [
            ...(Array.isArray(filters.toEmails) ? filters.toEmails : []),
            ...(Array.isArray(filters.toDomains) ? filters.toDomains : []),
        ]);
        if (toGroup) query = appendQueryToken(query, toGroup);

        const ccGroup = buildOrGroup("cc", [
            ...(Array.isArray(filters.ccEmails) ? filters.ccEmails : []),
            ...(Array.isArray(filters.ccDomains) ? filters.ccDomains : []),
        ]);
        if (ccGroup) query = appendQueryToken(query, ccGroup);

        const from = filters.from?.trim();
        if (from && !fromGroup) query = appendQueryToken(query, `from:${quoteQueryValue(from)}`);

        const to = filters.to?.trim();
        if (to && !toGroup) query = appendQueryToken(query, `to:${quoteQueryValue(to)}`);

        const cc = filters.cc?.trim();
        if (cc && !ccGroup) query = appendQueryToken(query, `cc:${quoteQueryValue(cc)}`);

        const subjectContains = filters.subjectContains?.trim();
        if (subjectContains) {
            query = appendQueryToken(
                query,
                `subject:${quoteQueryValue(subjectContains)}`,
            );
        }

        const text = filters.text?.trim();
        if (text) query = appendQueryToken(query, quoteQueryValue(text));

        const attachmentIntentTerm = filters.attachmentIntentTerm?.trim();
        if (attachmentIntentTerm) {
            query = appendQueryToken(query, quoteQueryValue(attachmentIntentTerm));
        }

        if (filters.hasAttachment === true) {
            query = appendQueryToken(query, "has:attachment");
        }

        if (filters.category) {
            query = appendQueryToken(query, `category:${filters.category}`);
        }

        if (filters.sentByMe === true) {
            query = appendQueryToken(
                query,
                `from:${quoteQueryValue(account.email)}`,
            );
        }

        if (filters.receivedByMe === true) {
            query = appendQueryToken(
                query,
                `to:${quoteQueryValue(account.email)}`,
            );
        }

        return query;
    };

    const throttleKey = `email:${account.id}`;
    const runThrottled = async <T>(operation: string, run: () => Promise<T>): Promise<T> =>
        withToolThrottle({
            key: throttleKey,
            maxConcurrent: 4,
            operation,
            run,
        });

    return {
        name: service.name,
        getUnreadCount: async (options?: { scope?: "inbox" | "primary" | "all" }) => runThrottled("getUnreadCount", async () => {
            try {
                return await service.getUnreadCount(options);
            } catch (err: unknown) {
                if (isGmailAuthError(err)) {
                    throw new Error(GMAIL_RECONNECT_MESSAGE);
                }
                throw err;
            }
        }),

        search: async ({
            query,
            limit,
            fetchAll,
            pageToken,
            includeNonPrimary,
            before,
            after,
            subjectContains,
            bodyContains,
            text,
            from,
            to,
            cc,
            fromEmails,
            fromDomains,
            toEmails,
            toDomains,
            ccEmails,
            ccDomains,
            category,
            hasAttachment,
            attachmentIntentTerm,
            attachmentMimeTypes,
            attachmentFilenameContains,
            sentByMe,
            receivedByMe,
        }) => runThrottled("search", async () => {
            try {
                const searchTimeoutBudgetMs = computeSearchTimeoutBudgetMs({
                    fetchAll,
                    limit,
                });
                const deadlineMs = Date.now() + searchTimeoutBudgetMs;
                const pageTimeoutMs = computeSearchPageTimeoutMs(Boolean(fetchAll));
                const runPagedSearch = async (params: {
                    query?: string;
                    maxResults?: number;
                    pageToken?: string;
                    includeNonPrimary?: boolean;
                    before?: Date;
                    after?: Date;
                    fetchAll?: boolean;
                }) => {
                    const remaining = remainingSearchBudget(deadlineMs);
                    if (remaining <= 0) {
                        throw new EmailOperationTimeoutError("search_total", searchTimeoutBudgetMs);
                    }
                    return withEmailOperationTimeout(
                        "search_page",
                        Math.min(pageTimeoutMs, remaining),
                        () => service.getMessagesWithPagination(params),
                    );
                };

                const localFilterOptions = {
                    subjectContains,
                    bodyContains,
                    text,
                    from,
                    to,
                    cc,
                    fromEmails,
                    fromDomains,
                    toEmails,
                    toDomains,
                    ccEmails,
                    ccDomains,
                    category,
                    hasAttachment,
                    attachmentIntentTerm,
                    attachmentMimeTypes,
                    attachmentFilenameContains,
                    sentByMe,
                    receivedByMe,
                };
                const scopedQuery = hasLocalFilter(localFilterOptions)
                    ? buildProviderScopedQuery({
                        baseQuery: query ?? "",
                        filters: localFilterOptions,
                    })
                    : query;

                if (!hasLocalFilter(localFilterOptions)) {
                    return await runPagedSearch({
                        query: scopedQuery,
                        maxResults: limit,
                        pageToken,
                        includeNonPrimary,
                        before,
                        after,
                        fetchAll,
                    });
                }

                const targetCount = fetchAll ? (limit ?? 500) : (limit ?? 100);
                const pageSize = Math.min(
                    Math.max(targetCount, SEARCH_PAGE_SIZE_MIN),
                    SEARCH_PAGE_SIZE_MAX,
                );
                const filtered: ParsedMessage[] = [];
                let nextPageToken: string | undefined = pageToken;
                let totalEstimate: number | undefined;
                let pagesScanned = 0;
                let scannedMessages = 0;

                const maxPages = resolveGuardrailInt({
                    envName: fetchAll
                        ? "EMAIL_SEARCH_LOCAL_FILTER_MAX_PAGES_FETCH_ALL"
                        : "EMAIL_SEARCH_LOCAL_FILTER_MAX_PAGES",
                    fallback: fetchAll
                        ? LOCAL_FILTER_MAX_PAGES_FETCH_ALL_DEFAULT
                        : LOCAL_FILTER_MAX_PAGES_DEFAULT,
                    min: 1,
                    max: 100,
                });
                const maxScannedMessages = resolveGuardrailInt({
                    envName: fetchAll
                        ? "EMAIL_SEARCH_LOCAL_FILTER_MAX_SCANNED_MESSAGES_FETCH_ALL"
                        : "EMAIL_SEARCH_LOCAL_FILTER_MAX_SCANNED_MESSAGES",
                    fallback: fetchAll
                        ? LOCAL_FILTER_MAX_SCANNED_MESSAGES_FETCH_ALL_DEFAULT
                        : LOCAL_FILTER_MAX_SCANNED_MESSAGES_DEFAULT,
                    min: 20,
                    max: 10_000,
                });

                do {
                    pagesScanned += 1;
                    const res = await runPagedSearch({
                        query: scopedQuery,
                        maxResults: pageSize,
                        pageToken: nextPageToken,
                        includeNonPrimary,
                        before,
                        after,
                        fetchAll: false,
                    });

                    if (totalEstimate === undefined) {
                        totalEstimate = res.totalEstimate;
                    }

                    scannedMessages += res.messages.length;
                    const batch = applyLocalSearchFilters(res.messages, localFilterOptions);
                    filtered.push(...batch);
                    nextPageToken = res.nextPageToken;

                    if (pagesScanned >= maxPages || scannedMessages >= maxScannedMessages) {
                        logger.warn("Email local-filter guardrail reached", {
                            accountId: account.id,
                            query: scopedQuery,
                            fetchAll: Boolean(fetchAll),
                            pagesScanned,
                            maxPages,
                            scannedMessages,
                            maxScannedMessages,
                            matchedCount: filtered.length,
                            hasNextPage: Boolean(nextPageToken),
                        });
                        break;
                    }
                } while (nextPageToken && filtered.length < targetCount);

                return {
                    messages: filtered.slice(0, targetCount),
                    nextPageToken,
                    totalEstimate,
                };
            } catch (err: unknown) {
                if (err instanceof EmailOperationTimeoutError) {
                    throw new Error("Email search timed out before your provider responded.");
                }
                if (isGmailAuthError(err)) {
                    throw new Error(GMAIL_RECONNECT_MESSAGE);
                }
                const detail = err instanceof Error ? err.message : JSON.stringify(err);
                throw new Error(`Gmail search failed (query="${query}"): ${detail}`);
            }
        }),

        get: async (ids: string[]) => runThrottled("get", async () => {
            try {
                return await service.getMessagesBatch(ids);
            } catch (err: unknown) {
                if (isGmailAuthError(err)) {
                    throw new Error(GMAIL_RECONNECT_MESSAGE);
                }
                throw err;
            }
        }),

        modify: async (ids: string[], changes: EmailChanges) => runThrottled("modify", async () => {
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
            const markProcessed = (operation: string, threadId: string) =>
              processedThreads.add(
                createOperationIdempotencyToken({
                  scope: "email.modify",
                  operation,
                  entityId: threadId,
                }),
              );
            const isProcessed = (operation: string, threadId: string) =>
              processedThreads.has(
                createOperationIdempotencyToken({
                  scope: "email.modify",
                  operation,
                  entityId: threadId,
                }),
              );

            await runInBatches(ids, 3, async (id) => {
                try {
                    await withRetries(
                      async () => {
                        const threadId = messageToThread.get(id);
                        if (!threadId) {
                            logger.warn("Could not find thread ID for message", { messageId: id });
                            return;
                        }

                        // Archive (thread-level operation)
                        if (changes.archive && !isProcessed("archive", threadId)) {
                            await service.archiveThread(threadId, account.email);
                            markProcessed("archive", threadId);
                        }

                        // Trash (thread-level operation)
                        if (changes.trash && !isProcessed("trash", threadId)) {
                            await service.trashThread(threadId, account.email, "ai");
                            markProcessed("trash", threadId);
                        }

                        // Read/Unread (thread-level operation)
                        if (changes.read !== undefined && !isProcessed("read", threadId)) {
                            await service.markReadThread(threadId, changes.read);
                            markProcessed("read", threadId);
                        }
                        // Follow-up flag approximation: enable -> unread, disable -> read
                        if (
                            changes.followUp !== undefined &&
                            !isProcessed("followUp", threadId)
                        ) {
                            const read = changes.followUp === "disable";
                            await service.markReadThread(threadId, read);
                            markProcessed("followUp", threadId);
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
                              if (remove && remove.length > 0 && !isProcessed("removeLabels", threadId)) {
                                  await service.removeThreadLabels(threadId, remove);
                                  markProcessed("removeLabels", threadId);
                              }
                          }
                        // Sender unsubscribe/block action (message-level)
                        if (changes.unsubscribe) {
                            await service.blockUnsubscribedEmail(id);
                        }

                        // Optional provider move when a folder target is supplied
                        if (
                            typeof changes.targetFolderId === "string" &&
                            changes.targetFolderId.length > 0 &&
                              !isProcessed("move", threadId)
                          ) {
                              await service.moveThreadToFolder(threadId, account.email, changes.targetFolderId);
                              markProcessed("move", threadId);
                          }
                      },
                      {
                        attempts: 3,
                        baseDelayMs: 700,
                        isRetryable: isProviderRateLimitError,
                        onRetry: ({ attempt, attempts, delayMs }) => {
                          logger.warn("openworld.provider.retry", {
                            domain: "email",
                            operation: "modify",
                            provider: account.provider,
                            attempt,
                            attempts,
                            delayMs,
                          });
                        },
                        onExhausted: ({ attempts, error }) => {
                          logger.error("openworld.provider.retry_exhausted", {
                            domain: "email",
                            operation: "modify",
                            provider: account.provider,
                            attempts,
                            error,
                          });
                        },
                      },
                    );
                    count++;
                } catch (e) {
                    logger.error("Failed to modify item", { id, error: e });
                }
            });

            return { success: true, count };
        }),

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
                    cc: params.cc?.join(", "),
                    bcc: params.bcc?.join(", "),
                    subject: params.subject || "",
                    messageHtml: params.body || "",
                });
                draftId = res.id;
            } else if (params.type === "reply" && params.parentId) {
                const res = await service.createDraft({
                    to: params.to?.join(", ") || "",
                    cc: params.cc?.join(", "),
                    bcc: params.bcc?.join(", "),
                    subject: params.subject || "",
                    messageHtml: params.body || "",
                    replyToMessageId: params.parentId
                });
                draftId = res.id;
            } else if (params.type === "forward" && params.parentId) {
                const res = await service.createDraft({
                    to: params.to?.join(", ") || "",
                    cc: params.cc?.join(", "),
                    bcc: params.bcc?.join(", "),
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

        trash: async (ids: string[]) => runThrottled("trash", async () => {
            try {
            const messages = await service.getMessagesBatch(ids);
            const threadIds = [...new Set(messages.map(m => m.threadId))];

            let count = 0;
            await runInBatches(threadIds, 5, async (tid) => {
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
        }),

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
        markSpam: async (threadId: string) => {
            try {
                await service.markSpam(threadId);
            } catch (err: unknown) {
                if (isGmailAuthError(err)) {
                    throw new Error(GMAIL_RECONNECT_MESSAGE);
                }
                throw err;
            }
        },
        blockUnsubscribedEmail: async (messageId: string) => {
            try {
                await service.blockUnsubscribedEmail(messageId);
            } catch (err: unknown) {
                if (isGmailAuthError(err)) {
                    throw new Error(GMAIL_RECONNECT_MESSAGE);
                }
                throw err;
            }
        },
        getFiltersList: async () => {
            try {
                return await service.getFiltersList();
            } catch (err: unknown) {
                if (isGmailAuthError(err)) {
                    throw new Error(GMAIL_RECONNECT_MESSAGE);
                }
                throw err;
            }
        },
        createFilter: async (options) => {
            try {
                return await service.createFilter(options);
            } catch (err: unknown) {
                if (isGmailAuthError(err)) {
                    throw new Error(GMAIL_RECONNECT_MESSAGE);
                }
                throw err;
            }
        },
        deleteFilter: async (id: string) => {
            try {
                return await service.deleteFilter(id);
            } catch (err: unknown) {
                if (isGmailAuthError(err)) {
                    throw new Error(GMAIL_RECONNECT_MESSAGE);
                }
                throw err;
            }
        },
        createAutoArchiveFilter: async (options) => {
            try {
                return await service.createAutoArchiveFilter(options);
            } catch (err: unknown) {
                if (isGmailAuthError(err)) {
                    throw new Error(GMAIL_RECONNECT_MESSAGE);
                }
                throw err;
            }
        },
        moveThreadToFolder: async (threadId: string, folderName: string) => {
            try {
                await service.moveThreadToFolder(threadId, account.email, folderName);
            } catch (err: unknown) {
                if (isGmailAuthError(err)) {
                    throw new Error(GMAIL_RECONNECT_MESSAGE);
                }
                throw err;
            }
        },

        // Extended
        getThread: async (threadId: string) => runThrottled("getThread", async () => {
            try {
                return await service.getThread(threadId);
            } catch (err: unknown) {
                if (isGmailAuthError(err)) {
                    throw new Error(GMAIL_RECONNECT_MESSAGE);
                }
                throw err;
            }
        }),

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
