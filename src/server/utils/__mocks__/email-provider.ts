import { vi } from "vitest";
import type { EmailProvider } from "@/server/services/email/types";

export const createMockEmailProvider = (
  overrides?: Partial<EmailProvider>,
): EmailProvider => {
  const mock: EmailProvider = {
    name: "google",
    toJSON: () => ({ name: "google", type: "MockEmailProvider" }),
    getThreads: vi.fn().mockResolvedValue([]),
    getThread: vi.fn().mockResolvedValue({
      id: "thread1",
      messages: [],
      snippet: "Test thread snippet",
    }),
    getLabels: vi.fn().mockResolvedValue([]),
    getLabelById: vi.fn().mockResolvedValue(null),
    getLabelByName: vi.fn().mockResolvedValue(null),
    getMessageByRfc822MessageId: vi.fn().mockResolvedValue(null),
    getFolders: vi.fn().mockResolvedValue([]),
    getSignatures: vi.fn().mockResolvedValue([]),
    getMessage: vi.fn().mockResolvedValue({
      id: "msg1",
      threadId: "thread1",
      headers: {
        from: "test@example.com",
        to: "user@example.com",
        subject: "Test",
        date: new Date().toISOString(),
      },
      snippet: "Test message",
      historyId: "12345",
      subject: "Test",
      date: new Date().toISOString(),
      textPlain: "Test content",
      textHtml: "<p>Test content</p>",
      attachments: [],
      inline: [],
      labelIds: [],
    }),
    getSentMessages: vi.fn().mockResolvedValue([]),
    getInboxMessages: vi.fn().mockResolvedValue([]),
    getSentMessageIds: vi.fn().mockResolvedValue([]),
    getSentThreadsExcluding: vi.fn().mockResolvedValue([]),
    getThreadMessages: vi.fn().mockResolvedValue([]),
    getThreadMessagesInInbox: vi.fn().mockResolvedValue([]),
    getPreviousConversationMessages: vi.fn().mockResolvedValue([]),
    archiveThread: vi.fn().mockResolvedValue(undefined),
    archiveThreadWithLabel: vi.fn().mockResolvedValue(undefined),
    archiveMessage: vi.fn().mockResolvedValue(undefined),
    trashThread: vi.fn().mockResolvedValue(undefined),
    bulkArchiveFromSenders: vi.fn().mockResolvedValue(undefined),
    bulkTrashFromSenders: vi.fn().mockResolvedValue(undefined),
    labelMessage: vi.fn().mockResolvedValue({}),
    removeThreadLabel: vi.fn().mockResolvedValue(undefined),
    removeThreadLabels: vi.fn().mockResolvedValue(undefined),
    draftEmail: vi.fn().mockResolvedValue({ draftId: "draft1" }),
    replyToEmail: vi.fn().mockResolvedValue(undefined),
    sendEmail: vi.fn().mockResolvedValue(undefined),
    forwardEmail: vi.fn().mockResolvedValue(undefined),
    markSpam: vi.fn().mockResolvedValue(undefined),
    blockUnsubscribedEmail: vi.fn().mockResolvedValue(undefined),
    markRead: vi.fn().mockResolvedValue(undefined),
    markReadThread: vi.fn().mockResolvedValue(undefined),
    getDraft: vi.fn().mockResolvedValue(null),
    deleteDraft: vi.fn().mockResolvedValue(undefined),
    sendDraft: vi
      .fn()
      .mockResolvedValue({ messageId: "sent-msg1", threadId: "thread1" }),
    createDraft: vi.fn().mockResolvedValue({ id: "draft-new" }),
    updateDraft: vi.fn().mockResolvedValue(undefined),
    createLabel: vi
      .fn()
      .mockResolvedValue({ id: "label1", name: "Test Label", type: "user" }),
    deleteLabel: vi.fn().mockResolvedValue(undefined),
    getOrCreateAmodelLabel: vi
      .fn()
      .mockResolvedValue({ id: "label1", name: "Test Label", type: "user" }),
    getOriginalMessage: vi.fn().mockResolvedValue(null),
    getFiltersList: vi.fn().mockResolvedValue([]),
    createFilter: vi.fn().mockResolvedValue({ status: 200 }),
    deleteFilter: vi.fn().mockResolvedValue({ status: 200 }),
    createAutoArchiveFilter: vi.fn().mockResolvedValue({ status: 200 }),
    getMessagesWithPagination: vi
      .fn()
      .mockResolvedValue({ messages: [], nextPageToken: undefined }),
    getMessagesFromSender: vi
      .fn()
      .mockResolvedValue({ messages: [], nextPageToken: undefined }),
    getMessagesWithAttachments: vi
      .fn()
      .mockResolvedValue({ messages: [], nextPageToken: undefined }),
    getThreadsWithParticipant: vi.fn().mockResolvedValue([]),
    getMessagesBatch: vi.fn().mockResolvedValue([]),
    getAccessToken: vi.fn().mockReturnValue("mock-token"),
    checkIfReplySent: vi.fn().mockResolvedValue(false),
    countReceivedMessages: vi.fn().mockResolvedValue(0),
    getAttachment: vi.fn().mockResolvedValue({ data: "", size: 0 }),
    getThreadsWithQuery: vi
      .fn()
      .mockResolvedValue({ threads: [], nextPageToken: undefined }),
    hasPreviousCommunicationsWithSenderOrDomain: vi.fn().mockResolvedValue(false),
    watchEmails: vi
      .fn()
      .mockResolvedValue({ expirationDate: new Date(), subscriptionId: "sub1" }),
    unwatchEmails: vi.fn().mockResolvedValue(undefined),
    isReplyInThread: vi.fn().mockReturnValue(false),
    isSentMessage: vi.fn().mockReturnValue(false),
    getThreadsFromSenderWithSubject: vi.fn().mockResolvedValue([]),
    processHistory: vi.fn().mockResolvedValue(undefined),
    moveThreadToFolder: vi.fn().mockResolvedValue(undefined),
    getOrCreateFolderIdByName: vi.fn().mockResolvedValue("folder1"),
    sendEmailWithHtml: vi
      .fn()
      .mockResolvedValue({ messageId: "sent-msg1", threadId: "thread1" }),
    getDrafts: vi.fn().mockResolvedValue([]),
    getThreadsWithLabel: vi.fn().mockResolvedValue([]),
    getLatestMessageInThread: vi.fn().mockResolvedValue(null),
    ...overrides,
  };
  return mock;
};

export const mockGmailProvider = createMockEmailProvider({ name: "google" });
export const mockOutlookProvider = createMockEmailProvider({
  name: "microsoft",
});
