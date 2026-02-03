import { z } from "zod";
import { createGenerateObject } from "@/server/lib/llms";
import type { EmailAccountWithAI } from "@/server/lib/llms/types";
import type { EmailForLLM } from "@/server/types";
import {
  stringifyEmailFromBody,
  stringifyEmailSimple,
} from "@/server/lib/stringify-email";
import { preprocessBooleanLike } from "@/server/lib/zod";
import { getModel } from "@/server/lib/llms/model";
import { getUserInfoPrompt } from "@/features/ai/helpers";
import { PROMPT_SECURITY_INSTRUCTIONS } from "@/features/ai/security";
import { createScopedLogger } from "@/server/lib/logger";

const logger = createScopedLogger("ai/check-if-needs-reply");

export async function aiCheckIfNeedsReply({
  emailAccount,
  messageToSend,
  threadContextMessages,
}: {
  emailAccount: EmailAccountWithAI;
  messageToSend: EmailForLLM;
  threadContextMessages: EmailForLLM[];
}) {
  // If messageToSend somehow is null/undefined, default to no reply needed.
  if (!messageToSend)
    return { needsReply: false, rationale: "No message provided" };

  const userMessageForPrompt = messageToSend;

  const system = `You are an AI assistant that checks if a reply is needed.

${PROMPT_SECURITY_INSTRUCTIONS}`;

  const prompt = `${getUserInfoPrompt({ emailAccount })}

We are sending the following message:

<message>
${stringifyEmailSimple(userMessageForPrompt)}
</message>

${
  threadContextMessages.length > 0
    ? `Previous messages in the thread for context:

<previous_messages>
${threadContextMessages
  .map((message) => `<message>${stringifyEmailFromBody(message)}</message>`)
  .join("\n")}
</previous_messages>`
    : ""
}

Decide if the message we are sending needs a reply. Respond with a JSON object with the following fields:
- rationale: Brief one-line explanation for the decision.
- needsReply: Whether a reply is needed.
`.trim();

  const modelOptions = getModel();

  const generateObject = createGenerateObject({
    emailAccount,
    label: "Check if needs reply",
    modelOptions,
  });

  try {
    const aiResponse = await generateObject({
      ...modelOptions,
      system,
      prompt,
      schema: z.object({
        rationale: z
          .string()
          .describe("Brief one-line explanation for the decision."),
        needsReply: z.preprocess(
          preprocessBooleanLike,
          z.boolean().describe("Whether a reply is needed."),
        ),
      }),
    });

    return aiResponse.object;
  } catch (error) {
    logger.error("Failed to check if needs reply", { error });
    // Return conservative default - assume no reply needed on error
    return { needsReply: false, rationale: "Error checking reply status" };
  }
}
