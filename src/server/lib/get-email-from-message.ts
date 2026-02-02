import type { ParsedMessage, EmailForLLM } from "@/server/types";
import { emailToContent, type EmailToContentOptions } from "@/server/lib/mail";
import { internalDateToDate } from "@/server/lib/date";

// Convert a ParsedMessage to an EmailForLLM
export function getEmailForLLM(
  message: ParsedMessage,
  contentOptions?: EmailToContentOptions,
): EmailForLLM {
  return {
    id: message.id,
    from: message.headers.from,
    to: message.headers.to,
    replyTo: message.headers["reply-to"],
    cc: message.headers.cc,
    subject: message.headers.subject,
    content: emailToContent(message, contentOptions),
    date: internalDateToDate(message.internalDate),
    attachments: message.attachments?.map((attachment) => ({
      filename: attachment.filename,
      mimeType: attachment.mimeType,
      size: attachment.size,
    })),
  };
}
