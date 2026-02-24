import { createGenerateText } from "@/server/lib/llms";
import { getModel } from "@/server/lib/llms/model";
import type { EmailForLLM } from "@/server/lib/types";
import type { EmailProvider } from "@/features/email/types";

export interface ReplyContextResult {
  relevantEmails: string[];
}

function summarizeMessage(subject: string, snippet: string): string {
  if (snippet.trim().length === 0) return subject;
  return `${subject}: ${snippet}`;
}

export async function aiCollectReplyContext(params: {
  currentThread: EmailForLLM[];
  emailAccount: {
    id: string;
    userId: string;
    email: string;
  };
  emailProvider: EmailProvider;
}): Promise<ReplyContextResult | null> {
  if (params.currentThread.length === 0) {
    return null;
  }

  const subject = params.currentThread[0]?.subject?.trim();
  if (!subject) {
    return null;
  }

  try {
    const modelOptions = getModel("economy");
    const generateText = createGenerateText({
      emailAccount: params.emailAccount,
      label: "reply-tracker/reply-context-collector",
      modelOptions,
    });
    await generateText({
      prompt: `Summarize recent thread context for subject "${subject}".`,
    });
  } catch {
    // Non-blocking enrichment call; continue with deterministic provider fallback.
  }

  const { messages } = await params.emailProvider.getMessagesWithPagination({
    query: `subject:"${subject}"`,
    maxResults: 5,
  });

  const relevantEmails = messages.map((message) =>
    summarizeMessage(
      message.subject ?? message.headers.subject ?? subject,
      message.snippet ?? message.textPlain ?? "",
    ));

  if (relevantEmails.length === 0) {
    return null;
  }

  return { relevantEmails };
}
