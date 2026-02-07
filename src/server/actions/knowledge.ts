"use server";

import prisma from "@/server/db/client";
import {
  createKnowledgeBody,
  updateKnowledgeBody,
  deleteKnowledgeBody,
} from "@/actions/knowledge.validation";
import { actionClient } from "@/actions/safe-action";
import { SafeError } from "@/server/lib/error";
import {
  KNOWLEDGE_BASIC_MAX_ITEMS,
  KNOWLEDGE_BASIC_MAX_CHARS,
} from "@/server/lib/config";
import { PremiumTier } from "@/generated/prisma/enums";
import { checkHasAccess } from "@/features/premium/server";

export const createKnowledgeAction = actionClient
  .metadata({ name: "createKnowledge" })
  .inputSchema(createKnowledgeBody)
  .action(
    async ({
      ctx: { emailAccountId, userId },
      parsedInput: { title, content },
    }) => {
      const knowledgeCount = await prisma.knowledge.count({
        where: { userId },
      });

      if (
        knowledgeCount >= KNOWLEDGE_BASIC_MAX_ITEMS ||
        content.length > KNOWLEDGE_BASIC_MAX_CHARS
      ) {
        const hasAccess = await checkHasAccess({
          userId,
          minimumTier: PremiumTier.BUSINESS_PLUS_MONTHLY,
        });

        if (!hasAccess) {
          throw new SafeError(
            `You can save up to ${KNOWLEDGE_BASIC_MAX_CHARS} characters and ${KNOWLEDGE_BASIC_MAX_ITEMS} item to your knowledge base. Upgrade to a higher tier to save unlimited content.`,
          );
        }
      }

      await prisma.knowledge.create({
        data: {
          title,
          content,
          userId,
          emailAccountId,
        },
      });
    },
  );

export const updateKnowledgeAction = actionClient
  .metadata({ name: "updateKnowledge" })
  .inputSchema(updateKnowledgeBody)
  .action(
    async ({
      ctx: { emailAccountId, userId },
      parsedInput: { id, title, content },
    }) => {
      if (content.length > KNOWLEDGE_BASIC_MAX_CHARS) {
        const hasAccess = await checkHasAccess({
          userId,
          minimumTier: PremiumTier.BUSINESS_PLUS_MONTHLY,
        });

        if (!hasAccess) {
          throw new SafeError(
            `You can save up to ${KNOWLEDGE_BASIC_MAX_CHARS} characters to your knowledge base. Upgrade to a higher tier to save unlimited content.`,
          );
        }
      }

      await prisma.knowledge.update({
        where: { id, userId },
        data: { title, content },
      });
    },
  );

export const deleteKnowledgeAction = actionClient
  .metadata({ name: "deleteKnowledge" })
  .inputSchema(deleteKnowledgeBody)
  .action(async ({ ctx: { userId }, parsedInput: { id } }) => {
    await prisma.knowledge.delete({
      where: { id, userId },
    });
  });
