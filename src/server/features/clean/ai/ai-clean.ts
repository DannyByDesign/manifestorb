import { z } from "zod";
import type { EmailAccountWithAI } from "@/server/lib/llms/types";
import type { EmailForLLM } from "@/server/types";
import { stringifyEmailSimple } from "@/server/lib/stringify-email";
import { formatDateForLLM, formatRelativeTimeForLLM } from "@/server/lib/date";
import { preprocessBooleanLike } from "@/server/lib/zod";
import { getModel } from "@/server/lib/llms/model";
import { createGenerateObject } from "@/server/lib/llms";
import { PROMPT_SECURITY_INSTRUCTIONS } from "@/features/ai/security";
import { createScopedLogger } from "@/server/lib/logger";

const logger = createScopedLogger("ai/clean");

// TODO: allow specific labels
// Pass in prompt labels
const schema = z.object({
  archive: z.preprocess(preprocessBooleanLike, z.boolean()),
  // label: z.string().optional(),
  // reasoning: z.string(),
});

export async function aiClean({
  emailAccount,
  messageId: _messageId,
  messages,
  instructions,
  skips,
}: {
  emailAccount: EmailAccountWithAI;
  messageId: string;
  messages: EmailForLLM[];
  instructions?: string;
  skips: {
    reply?: boolean | null;
    receipt?: boolean | null;
  };
}): Promise<{ archive: boolean }> {
  const lastMessage = messages.at(-1);

  if (!lastMessage) throw new Error("No messages");

  const system =
    `You are an AI assistant designed to help users achieve inbox zero by analyzing emails and deciding whether they should be archived or not.

${PROMPT_SECURITY_INSTRUCTIONS}
  
Examples of emails to archive:
- Newsletters
- Marketing
- Notifications
- Low-priority emails
- Notifications
- Social
- LinkedIn messages
- Facebook messages
- GitHub issues

${skips.reply ? "Do not archive emails that the user needs to reply to. But do archive old emails that are clearly not needed." : ""}
${
  skips.receipt
    ? `Do not archive emails that are actual financial records: receipts, payment confirmations, or invoices.
However, do archive payment-related communications like overdue payment notifications, payment reminders, or subscription renewal notices.`
    : ""
}

Return your response in JSON format.`.trim();

  const message = `${stringifyEmailSimple(lastMessage)}
  ${
    lastMessage.date
      ? `<date>${formatDateForLLM(lastMessage.date)} (${formatRelativeTimeForLLM(lastMessage.date)})</date>`
      : ""
  }`;

  const currentDate = formatDateForLLM(new Date());

  const prompt = `
${
  instructions
    ? `Additional user instructions:
<instructions>${instructions}</instructions>`
    : ""
}

The email to analyze:

<email>
${message}
</email>

The current date is ${currentDate}.
`.trim();

  // ${user.about ? `<user_background_information>${user.about}</user_background_information>` : ""}

  const modelOptions = getModel(emailAccount.user);

  const generateObject = createGenerateObject({
    emailAccount,
    label: "Clean",
    modelOptions,
  });

  try {
    const aiResponse = await generateObject({
      ...modelOptions,
      system,
      prompt,
      schema,
    });

    return aiResponse.object as { archive: boolean };
  } catch (error) {
    logger.error("Failed to clean email with AI", { error });
    // Return conservative default - don't archive on error
    return { archive: false };
  }
}
