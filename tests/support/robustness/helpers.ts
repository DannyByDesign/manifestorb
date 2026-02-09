import type {
  EmailForLLM,
  ParsedMessage,
  ParsedMessageHeaders,
} from "@/server/lib/types";

export type ToolCall = { toolName: string; input?: unknown };

export function getToolCalls(
  steps: Array<{ toolCalls?: Array<ToolCall | undefined> }>,
) {
  return steps
    .flatMap((step) => step.toolCalls ?? [])
    .filter((call): call is ToolCall => Boolean(call));
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

export function makeEmail({
  id = "msg-1",
  from = "sender@example.com",
  to = "user@example.com",
  subject = "Subject",
  content = "Body",
  date = new Date(),
}: Partial<EmailForLLM> = {}): EmailForLLM {
  return {
    id,
    from,
    to,
    subject,
    content,
    date,
  };
}

export function makeThread(messages: Array<Partial<EmailForLLM>>): EmailForLLM[] {
  return messages.map((message, idx) =>
    makeEmail({
      id: `msg-${idx + 1}`,
      ...message,
    }),
  );
}

export function makeParsedMessage({
  id = "msg-1",
  threadId = "thread-1",
  from = "sender@example.com",
  to = "user@example.com",
  subject = "Subject",
  textPlain = "Body",
}: {
  id?: string;
  threadId?: string;
  from?: string;
  to?: string;
  subject?: string;
  textPlain?: string;
}): ParsedMessage {
  const headers: ParsedMessageHeaders = {
    from,
    to,
    subject,
    date: new Date().toISOString(),
  };

  return {
    id,
    threadId,
    historyId: "history-1",
    headers,
    snippet: textPlain,
    textPlain,
    textHtml: `<p>${textPlain}</p>`,
    attachments: [],
    inline: [],
    labelIds: [],
    subject,
    date: new Date().toISOString(),
  };
}
