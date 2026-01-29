"use server";

import { generateReplySchema } from "@/server/services/unsubscriber/generate-reply.validation";
import { aiGenerateNudge } from "@/server/integrations/ai/reply/generate-nudge";
import { emailToContent } from "@/utils/mail";
import { getReply, saveReply } from "@/utils/redis/reply";
import { actionClient } from "@/server/services/unsubscriber/safe-action";
import { getEmailAccountWithAi } from "@/utils/user/get";
import { SafeError } from "@/server/utils/error";

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
