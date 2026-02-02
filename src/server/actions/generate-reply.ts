"use server";

import { generateReplySchema } from "@/actions/generate-reply.validation";
import { aiGenerateNudge } from "@/features/reply-tracker/ai/generate-nudge";
import { emailToContent } from "@/server/lib/mail";
import { getReply, saveReply } from "@/server/lib/redis/reply";
import { actionClient } from "@/actions/safe-action";
import { getEmailAccountWithAi } from "@/server/lib/user/get";
import { SafeError } from "@/server/lib/error";

export const generateNudgeReplyAction = actionClient
  .metadata({ name: "generateNudgeReply" })
  .inputSchema(generateReplySchema)
  .action(
    async ({
      ctx: { emailAccountId },
      parsedInput: { messages: inputMessages },
    }) => {
      const emailAccount = await getEmailAccountWithAi({ emailAccountId });

      if (!emailAccount) throw new SafeError("User not found");

      const lastMessage = inputMessages.at(-1);

      if (!lastMessage) throw new SafeError("No message provided");

      const reply = await getReply({
        emailAccountId,
        messageId: lastMessage.id,
      });

      if (reply) return { text: reply };

      const messages = inputMessages.map((msg) => ({
        ...msg,
        date: new Date(msg.date),
        content: emailToContent({
          textPlain: msg.textPlain,
          textHtml: msg.textHtml,
          snippet: "",
        }),
      }));

      const text = await aiGenerateNudge({ messages, emailAccount });
      await saveReply({
        emailAccountId,
        messageId: lastMessage.id,
        reply: text,
      });

      return { text };
    },
  );
