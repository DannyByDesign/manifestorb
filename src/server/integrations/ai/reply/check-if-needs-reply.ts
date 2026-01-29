import { z } from "zod";
import { createGenerateObject } from "@/server/utils/llms";
import type { EmailAccountWithAI } from "@/server/utils/llms/types";
import type { EmailForLLM } from "@/server/types";
import {
  stringifyEmailFromBody,
  stringifyEmailSimple,
} from "@/server/utils/stringify-email";
import { preprocessBooleanLike } from "@/server/utils/zod";
import { getModel } from "@/server/utils/llms/model";
import { getUserInfoPrompt } from "@/server/integrations/ai/helpers";
import { PROMPT_SECURITY_INSTRUCTIONS } from "@/server/integrations/ai/security";

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

  const modelOptions = getModel(emailAccount.user);

  const generateObject = createGenerateObject({
    emailAccount,
    label: "Check if needs reply",
    modelOptions,
  });

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
}
