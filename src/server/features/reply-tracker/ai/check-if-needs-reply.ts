import { z } from "zod";
import { createGenerateObject } from "@/server/lib/llms";
import { getModel } from "@/server/lib/llms/model";
import type { EmailForLLM } from "@/server/lib/types";

const outputSchema = z
  .object({
    needsReply: z.boolean(),
    rationale: z.string().min(1),
  })
  .strict();

export async function aiCheckIfNeedsReply(params: {
  emailAccount: {
    id: string;
    userId: string;
    email: string;
  };
  messageToSend: EmailForLLM | undefined;
  threadContextMessages: EmailForLLM[];
}): Promise<{ needsReply: boolean; rationale: string }> {
  if (!params.messageToSend) {
    return {
      needsReply: false,
      rationale: "No message provided",
    };
  }

  try {
    const modelOptions = getModel("economy");
    const generateObject = createGenerateObject({
      emailAccount: params.emailAccount,
      label: "reply-tracker/check-if-needs-reply",
      modelOptions,
    });
    const prompt = [
      "Decide whether this email needs a reply.",
      `Subject: ${params.messageToSend.subject ?? ""}`,
      `From: ${params.messageToSend.from ?? ""}`,
      `To: ${params.messageToSend.to ?? ""}`,
      `Body: ${params.messageToSend.content ?? ""}`,
      `Thread context count: ${params.threadContextMessages.length}`,
    ].join("\n");

    const { object } = await generateObject({
      schema: outputSchema,
      prompt,
    });

    return {
      needsReply: object.needsReply,
      rationale: object.rationale,
    };
  } catch {
    return {
      needsReply: false,
      rationale: "Error checking reply status",
    };
  }
}
