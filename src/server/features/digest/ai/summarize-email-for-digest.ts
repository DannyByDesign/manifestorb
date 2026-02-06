import { z } from "zod";
import type { EmailAccountWithAI } from "@/server/lib/llms/types";
import { createScopedLogger } from "@/server/lib/logger";
import type { EmailForLLM } from "@/server/types";
import { stringifyEmailSimple } from "@/server/lib/stringify-email";
import { getModel } from "@/server/lib/llms/model";
import { createGenerateObject } from "@/server/lib/llms";
import { getUserInfoPrompt } from "@/features/ai/helpers";
import { PROMPT_SECURITY_INSTRUCTIONS } from "@/features/ai/security";

const logger = createScopedLogger("summarize-digest-email");

const schema = z.object({
  content: z.string().describe("The content of the summary text"),
});
type AISummarizeResult = z.infer<typeof schema>;

export async function aiSummarizeEmailForDigest({
  ruleName,
  emailAccount,
  messageToSummarize,
}: {
  ruleName: string;
  emailAccount: EmailAccountWithAI & { name: string | null };
  messageToSummarize: EmailForLLM | null;
}): Promise<AISummarizeResult | null> {
  // If messageToSummarize somehow is null/undefined, default to null.
  if (!messageToSummarize) return null;

  const userMessageForPrompt = messageToSummarize;

  const system = `You are an AI assistant that processes emails for inclusion in a daily digest.
Your task is to summarize the content accordingly using the provided schema.

${PROMPT_SECURITY_INSTRUCTIONS}

I will provide you with:
- A user's name and some context about them.
- The email category
- The email content

Guidelines for summarizing the email:
- If the email is spam or clearly irrelevant, return an empty string.
- If there is nothing worth summarizing, return a short, direct summary based on the subject or first sentence.
- Do NOT mention the sender's name or start with phrases like "This is a message from X" or "This email from Y" - the sender information is already displayed separately.
- DO NOT use meta-commentary like "highlights", "discusses", "reflects on", "mentions", or "talks about" - just state the content directly.
- Lead with the most interesting or important point - the hook, main insight, or key takeaway.
- Be engaging and direct - write like you're telling someone the key points, not describing what the email contains.
- Keep each line short. No wrap-up lines or "bottom line" summaries.
- When there are multiple items or pieces of information, use newlines to separate them (they will be rendered as bullet points automatically).
- DO NOT include bullet point characters (•, -, *, etc.) - just separate items with newlines.
- For newsletters and content emails:
  • Keep it concise - aim for 1-5 key points maximum, not a comprehensive summary
  • Lead with the main story, insight, or most interesting point
  • Include specific details that make it concrete (numbers, names, context)
  • Skip background details, tangential points, and filler content
  • Minimize or skip promotional content unless it's the primary purpose
  • Example: "Simple habit tracker app makes $30K/month despite thousands of competitors. Key lesson: stop overthinking and just build. AI tools now let anyone create apps without coding."
- For structured data (orders, confirmations, receipts):
  • Use a single paragraph or newlines to separate key information in "Key: Value" format
  • Include only the most relevant details (totals, dates, tracking)
  • Example: "Order Total: $99.99\\nDelivery Date: March 15\\nTracking: 1Z999AA"
- For announcements with multiple items:
  • List the key topics or news items, one per line
  • Be direct and specific
  • Example: "New feature launches next week\\n20% discount on all plans\\nWebinar scheduled for Friday"
- For direct messages:
  • Summarize in the second person (as if talking directly to the user)
  • Use phrasing like: "You have received…", "You are invited…", "Your request has been…"
  • Use newlines if there are multiple action items or pieces of information
- Only include human-relevant and human-readable information.
- Exclude opaque technical identifiers like account IDs, payment IDs, tracking tokens, or long alphanumeric strings that aren't meaningful to users.
`;

  const prompt = `
<email>
  <content>${stringifyEmailSimple(userMessageForPrompt)}</content>
  <category>${ruleName}</category>
</email>

${getUserInfoPrompt({ emailAccount })}`;

  logger.info("Summarizing email for digest");

  try {
    const modelOptions = getModel();

    const generateObject = createGenerateObject({
      emailAccount,
      label: "Summarize email",
      modelOptions,
    });

    const aiResponse = await generateObject({
      ...modelOptions,
      system,
      prompt,
      schema,
    });

    const content = aiResponse.object?.content?.trim();
    const fallback = buildFallbackSummary(messageToSummarize);
    if (!content) return fallback ? { content: fallback } : null;

    const cleanedLines = content
      .split("\n")
      .map((line) => line.replace(/^[-*•]\s*/, "").trim())
      .filter((line) => line.length > 0)
      .slice(0, 4);

    if (cleanedLines.length === 0) {
      return fallback ? { content: fallback } : null;
    }

    return { content: cleanedLines.join("\n") };
  } catch (error) {
    logger.error("Failed to summarize email", { error });

    return null;
  }
}

function buildFallbackSummary(message: EmailForLLM): string | null {
  const subject = message.subject?.trim();
  const content = message.content?.trim();
  const candidate = content && content.length > 0 ? content : subject;

  if (!candidate) return null;

  const firstLine =
    candidate
      .split("\n")
      .map((line) => line.replace(/^[-*•]\s*/, "").trim())
      .find((line) => line.length > 0) ?? "";

  if (!firstLine) return null;

  return firstLine.slice(0, 200);
}
