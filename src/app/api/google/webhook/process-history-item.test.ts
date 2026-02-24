import { beforeEach, describe, expect, it, vi } from "vitest";
import type { gmail_v1 } from "@googleapis/gmail";
import { processHistoryItem } from "./process-history-item";
import { HistoryEventType, type ProcessHistoryOptions } from "./types";
import { getEmailAccount } from "@/tests/support/helpers";
import { createScopedLogger } from "@/server/lib/logger";

const {
  createEmailProviderMock,
  markMessageAsProcessingMock,
  handleLabelRemovedEventMock,
  sharedProcessHistoryItemMock,
} = vi.hoisted(() => ({
  createEmailProviderMock: vi.fn(),
  markMessageAsProcessingMock: vi.fn(),
  handleLabelRemovedEventMock: vi.fn(),
  sharedProcessHistoryItemMock: vi.fn(),
}));

vi.mock("@/features/email/provider", () => ({
  createEmailProvider: createEmailProviderMock,
}));

vi.mock("@/server/lib/redis/message-processing", () => ({
  markMessageAsProcessing: markMessageAsProcessingMock,
}));

vi.mock("@/app/api/google/webhook/process-label-removed-event", () => ({
  handleLabelRemovedEvent: handleLabelRemovedEventMock,
}));

vi.mock("@/features/webhooks/process-history-item", () => ({
  processHistoryItem: sharedProcessHistoryItemMock,
}));

const logger = createScopedLogger("webhook/process-history-item.test");

function makeOptions(overrides?: Partial<ProcessHistoryOptions>): ProcessHistoryOptions {
  return {
    history: [],
    gmail: {} as gmail_v1.Gmail,
    accessToken: "test-token",
    hasAutomationRules: true,
    hasAiAccess: true,
    emailAccount: {
      ...getEmailAccount(),
      autoCategorizeSenders: false,
    },
    ...overrides,
  };
}

function makeHistoryItem(params?: {
  messageId?: string;
  threadId?: string;
  type?: (typeof HistoryEventType)[keyof typeof HistoryEventType];
  labelIds?: string[];
}) {
  const type = params?.type ?? HistoryEventType.MESSAGE_ADDED;
  const messageId = params?.messageId ?? "message-123";
  const threadId = params?.threadId ?? "thread-123";

  if (type === HistoryEventType.LABEL_REMOVED || type === HistoryEventType.LABEL_ADDED) {
    return {
      type,
      item: {
        message: {
          id: messageId,
          threadId,
          labelIds: params?.labelIds ?? [],
        },
      } as gmail_v1.Schema$HistoryLabelRemoved,
    };
  }

  return {
    type,
    item: {
      message: {
        id: messageId,
        threadId,
      },
    } as gmail_v1.Schema$HistoryMessageAdded,
  };
}

describe("google webhook processHistoryItem wrapper", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    createEmailProviderMock.mockResolvedValue({ name: "google" });
    markMessageAsProcessingMock.mockResolvedValue(true);
  });

  it("returns early when message id or thread id is missing", async () => {
    const options = makeOptions();
    await processHistoryItem(
      {
        type: HistoryEventType.MESSAGE_ADDED,
        item: {
          message: {
            id: undefined,
            threadId: "thread-123",
          },
        } as gmail_v1.Schema$HistoryMessageAdded,
      },
      options,
      logger,
    );

    expect(createEmailProviderMock).not.toHaveBeenCalled();
    expect(sharedProcessHistoryItemMock).not.toHaveBeenCalled();
  });

  it("delegates label removed events to label handler", async () => {
    const options = makeOptions();
    const historyItem = makeHistoryItem({
      type: HistoryEventType.LABEL_REMOVED,
      labelIds: ["INBOX"],
    });
    const provider = { name: "google" };
    createEmailProviderMock.mockResolvedValueOnce(provider);

    await processHistoryItem(historyItem, options, logger);

    expect(handleLabelRemovedEventMock).toHaveBeenCalledWith(
      historyItem.item,
      expect.objectContaining({
        emailAccount: options.emailAccount,
        provider,
      }),
      logger,
    );
    expect(sharedProcessHistoryItemMock).not.toHaveBeenCalled();
  });

  it("skips processing when message lock is already held", async () => {
    const options = makeOptions();
    markMessageAsProcessingMock.mockResolvedValueOnce(false);

    await processHistoryItem(
      makeHistoryItem({ type: HistoryEventType.MESSAGE_ADDED }),
      options,
      logger,
    );

    expect(sharedProcessHistoryItemMock).not.toHaveBeenCalled();
  });

  it("delegates message-added events to shared processor", async () => {
    const options = makeOptions({
      hasAutomationRules: false,
      hasAiAccess: true,
    });
    const provider = { name: "google" };
    createEmailProviderMock.mockResolvedValueOnce(provider);

    await processHistoryItem(
      makeHistoryItem({
        type: HistoryEventType.MESSAGE_ADDED,
        messageId: "message-456",
        threadId: "thread-456",
      }),
      options,
      logger,
    );

    expect(sharedProcessHistoryItemMock).toHaveBeenCalledWith(
      {
        messageId: "message-456",
        threadId: "thread-456",
      },
      expect.objectContaining({
        provider,
        emailAccount: options.emailAccount,
        hasAutomationRules: false,
        hasAiAccess: true,
        logger,
      }),
    );
  });

  it("ignores label-added events", async () => {
    const options = makeOptions();

    await processHistoryItem(
      makeHistoryItem({
        type: HistoryEventType.LABEL_ADDED,
      }),
      options,
      logger,
    );

    expect(markMessageAsProcessingMock).not.toHaveBeenCalled();
    expect(sharedProcessHistoryItemMock).not.toHaveBeenCalled();
  });
});
