import { describe, expect, it, vi } from "vitest";

vi.mock("@/features/email/provider", () => ({
  createEmailProvider: vi.fn(),
}));

import { createEmailProvider } from "./email";

describe("tool email provider search", () => {
  it("applies local semantic filters for subject/body on top of service search", async () => {
    const service = {
      getMessagesWithPagination: vi
        .fn()
        .mockResolvedValueOnce({
          messages: [
            {
              id: "m-1",
              threadId: "t-1",
              snippet: "E2E body",
              historyId: "h-1",
              inline: [],
              headers: {
                subject: "E2E test",
                from: "me@example.com",
                to: "me@example.com",
                date: "2026-02-08T00:00:00.000Z",
              },
              subject: "E2E test",
              textPlain: "Delete E2E clutter",
              date: "2026-02-08T00:00:00.000Z",
            },
            {
              id: "m-2",
              threadId: "t-2",
              snippet: "Other",
              historyId: "h-2",
              inline: [],
              headers: {
                subject: "Quarterly update",
                from: "finance@example.com",
                to: "me@example.com",
                date: "2026-02-08T01:00:00.000Z",
              },
              subject: "Quarterly update",
              textPlain: "Budget notes",
              date: "2026-02-08T01:00:00.000Z",
            },
          ],
          nextPageToken: undefined,
          totalEstimate: 2,
        }),
      getMessagesBatch: vi.fn(),
      getThread: vi.fn(),
      searchContacts: vi.fn(),
      createContact: vi.fn(),
      createDraft: vi.fn(),
      sendDraft: vi.fn(),
      getDrafts: vi.fn(),
      getDraft: vi.fn(),
      updateDraft: vi.fn(),
      deleteDraft: vi.fn(),
      archiveThread: vi.fn(),
      trashThread: vi.fn(),
      markReadThread: vi.fn(),
      labelMessage: vi.fn(),
      removeThreadLabels: vi.fn(),
    } as unknown as Awaited<ReturnType<typeof import("@/features/email/provider")["createEmailProvider"]>>;

    const providerFactory = (await import("@/features/email/provider")).createEmailProvider as unknown as {
      mockResolvedValue: (value: unknown) => void;
    };
    providerFactory.mockResolvedValue(service);

    const provider = await createEmailProvider(
      {
        id: "email-1",
        provider: "google",
        access_token: null,
        refresh_token: null,
        expires_at: null,
        email: "me@example.com",
      },
      {
        info: vi.fn(),
        warn: vi.fn(),
        error: vi.fn(),
        debug: vi.fn(),
        trace: vi.fn(),
        with: vi.fn().mockReturnThis(),
      } as unknown as Parameters<typeof createEmailProvider>[1],
    );

    const result = await provider.search({
      query: "",
      limit: 10,
      subjectContains: "E2E",
      bodyContains: "clutter",
    });

    expect(service.getMessagesWithPagination).toHaveBeenCalledTimes(1);
    expect(result.messages).toHaveLength(1);
    expect(result.messages[0]?.id).toBe("m-1");
  });

  it("matches sender names flexibly (full name vs initial variants)", async () => {
    const service = {
      getMessagesWithPagination: vi.fn().mockResolvedValue({
        messages: [
          {
            id: "m-1",
            threadId: "t-1",
            snippet: "LinkedIn message",
            historyId: "h-1",
            inline: [],
            headers: {
              subject: "Yingying just messaged you",
              from: "Yingying S via LinkedIn <messages-noreply@linkedin.com>",
              to: "me@example.com",
              date: "2026-02-08T00:00:00.000Z",
            },
            subject: "Yingying just messaged you",
            textPlain: "Ping",
            date: "2026-02-08T00:00:00.000Z",
          },
          {
            id: "m-2",
            threadId: "t-2",
            snippet: "Other sender",
            historyId: "h-2",
            inline: [],
            headers: {
              subject: "Quarterly update",
              from: "Finance Bot <finance@example.com>",
              to: "me@example.com",
              date: "2026-02-08T01:00:00.000Z",
            },
            subject: "Quarterly update",
            textPlain: "Budget notes",
            date: "2026-02-08T01:00:00.000Z",
          },
          {
            id: "m-3",
            threadId: "t-3",
            snippet: "Mom ping",
            historyId: "h-3",
            inline: [],
            headers: {
              subject: "Checking in",
              from: "ysun@example.com",
              to: "me@example.com",
              date: "2026-02-08T02:00:00.000Z",
            },
            subject: "Checking in",
            textPlain: "Hi",
            date: "2026-02-08T02:00:00.000Z",
          },
        ],
        nextPageToken: undefined,
        totalEstimate: 3,
      }),
      getMessagesBatch: vi.fn(),
      getThread: vi.fn(),
      searchContacts: vi.fn(),
      createContact: vi.fn(),
      createDraft: vi.fn(),
      sendDraft: vi.fn(),
      getDrafts: vi.fn(),
      getDraft: vi.fn(),
      updateDraft: vi.fn(),
      deleteDraft: vi.fn(),
      archiveThread: vi.fn(),
      trashThread: vi.fn(),
      markReadThread: vi.fn(),
      labelMessage: vi.fn(),
      removeThreadLabels: vi.fn(),
    } as unknown as Awaited<ReturnType<typeof import("@/features/email/provider")["createEmailProvider"]>>;

    const providerFactory = (await import("@/features/email/provider")).createEmailProvider as unknown as {
      mockResolvedValue: (value: unknown) => void;
    };
    providerFactory.mockResolvedValue(service);

    const provider = await createEmailProvider(
      {
        id: "email-1",
        provider: "google",
        access_token: null,
        refresh_token: null,
        expires_at: null,
        email: "me@example.com",
      },
      {
        info: vi.fn(),
        warn: vi.fn(),
        error: vi.fn(),
        debug: vi.fn(),
        trace: vi.fn(),
        with: vi.fn().mockReturnThis(),
      } as unknown as Parameters<typeof createEmailProvider>[1],
    );

    const result = await provider.search({
      query: "",
      limit: 10,
      from: "Yingying Sun",
    });

    expect(result.messages).toHaveLength(2);
    expect(result.messages.map((message) => message.id)).toEqual(["m-1", "m-3"]);
  });

  it("matches sender names with minor typos", async () => {
    const service = {
      getMessagesWithPagination: vi.fn().mockResolvedValue({
        messages: [
          {
            id: "m-1",
            threadId: "t-1",
            snippet: "Portfolio update",
            historyId: "h-1",
            inline: [],
            headers: {
              subject: "Freelancer update",
              from: "Haseeb Khan <haseeb@fiverr.com>",
              to: "me@example.com",
              date: "2026-02-08T00:00:00.000Z",
            },
            subject: "Freelancer update",
            textPlain: "Here's the latest progress.",
            date: "2026-02-08T00:00:00.000Z",
          },
          {
            id: "m-2",
            threadId: "t-2",
            snippet: "Other sender",
            historyId: "h-2",
            inline: [],
            headers: {
              subject: "Status",
              from: "Alice <alice@example.com>",
              to: "me@example.com",
              date: "2026-02-08T01:00:00.000Z",
            },
            subject: "Status",
            textPlain: "Ping",
            date: "2026-02-08T01:00:00.000Z",
          },
        ],
        nextPageToken: undefined,
        totalEstimate: 2,
      }),
      getMessagesBatch: vi.fn(),
      getThread: vi.fn(),
      searchContacts: vi.fn(),
      createContact: vi.fn(),
      createDraft: vi.fn(),
      sendDraft: vi.fn(),
      getDrafts: vi.fn(),
      getDraft: vi.fn(),
      updateDraft: vi.fn(),
      deleteDraft: vi.fn(),
      archiveThread: vi.fn(),
      trashThread: vi.fn(),
      markReadThread: vi.fn(),
      labelMessage: vi.fn(),
      removeThreadLabels: vi.fn(),
    } as unknown as Awaited<ReturnType<typeof import("@/features/email/provider")["createEmailProvider"]>>;

    const providerFactory = (await import("@/features/email/provider")).createEmailProvider as unknown as {
      mockResolvedValue: (value: unknown) => void;
    };
    providerFactory.mockResolvedValue(service);

    const provider = await createEmailProvider(
      {
        id: "email-1",
        provider: "google",
        access_token: null,
        refresh_token: null,
        expires_at: null,
        email: "me@example.com",
      },
      {
        info: vi.fn(),
        warn: vi.fn(),
        error: vi.fn(),
        debug: vi.fn(),
        trace: vi.fn(),
        with: vi.fn().mockReturnThis(),
      } as unknown as Parameters<typeof createEmailProvider>[1],
    );

    const result = await provider.search({
      query: "",
      limit: 10,
      from: "hasseeb",
    });

    expect(result.messages).toHaveLength(1);
    expect(result.messages[0]?.id).toBe("m-1");
  });

  it("supports sentByMe and receivedByMe local filters", async () => {
    const service = {
      getMessagesWithPagination: vi.fn().mockResolvedValue({
        messages: [
          {
            id: "m-sent",
            threadId: "t-sent",
            snippet: "sent",
            historyId: "h-sent",
            inline: [],
            headers: {
              subject: "Sent item",
              from: "Me <me@example.com>",
              to: "friend@example.com",
              date: "2026-02-08T00:00:00.000Z",
            },
            subject: "Sent item",
            textPlain: "hello",
            date: "2026-02-08T00:00:00.000Z",
          },
          {
            id: "m-received",
            threadId: "t-received",
            snippet: "received",
            historyId: "h-received",
            inline: [],
            headers: {
              subject: "Received item",
              from: "friend@example.com",
              to: "me@example.com",
              date: "2026-02-08T01:00:00.000Z",
            },
            subject: "Received item",
            textPlain: "reply",
            date: "2026-02-08T01:00:00.000Z",
          },
        ],
        nextPageToken: undefined,
        totalEstimate: 2,
      }),
      getMessagesBatch: vi.fn(),
      getThread: vi.fn(),
      searchContacts: vi.fn(),
      createContact: vi.fn(),
      createDraft: vi.fn(),
      sendDraft: vi.fn(),
      getDrafts: vi.fn(),
      getDraft: vi.fn(),
      updateDraft: vi.fn(),
      deleteDraft: vi.fn(),
      archiveThread: vi.fn(),
      trashThread: vi.fn(),
      markReadThread: vi.fn(),
      labelMessage: vi.fn(),
      removeThreadLabels: vi.fn(),
    } as unknown as Awaited<ReturnType<typeof import("@/features/email/provider")["createEmailProvider"]>>;

    const providerFactory = (await import("@/features/email/provider")).createEmailProvider as unknown as {
      mockResolvedValue: (value: unknown) => void;
    };
    providerFactory.mockResolvedValue(service);

    const provider = await createEmailProvider(
      {
        id: "email-1",
        provider: "google",
        access_token: null,
        refresh_token: null,
        expires_at: null,
        email: "me@example.com",
      },
      {
        info: vi.fn(),
        warn: vi.fn(),
        error: vi.fn(),
        debug: vi.fn(),
        trace: vi.fn(),
        with: vi.fn().mockReturnThis(),
      } as unknown as Parameters<typeof createEmailProvider>[1],
    );

    const sent = await provider.search({
      query: "",
      sentByMe: true,
      limit: 10,
    });
    expect(sent.messages.map((message) => message.id)).toEqual(["m-sent"]);

    const received = await provider.search({
      query: "",
      receivedByMe: true,
      limit: 10,
    });
    expect(received.messages.map((message) => message.id)).toEqual(["m-received"]);
  });
});
