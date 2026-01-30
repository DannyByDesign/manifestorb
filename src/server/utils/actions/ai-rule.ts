"use server";

import { z } from "zod";
import prisma from "@/utils/prisma";
import { isNotFoundError, isDuplicateError } from "@/utils/prisma-helpers";
import {
  runRules,
  type RunRulesResult,
} from "@/utils/ai/choose-rule/run-rules";
import { emailToContent } from "@/utils/mail";
import {
  runRulesBody,
  testAiCustomContentBody,
} from "@/utils/actions/ai-rule.validation";
import {
  createRulesBody,
  saveRulesPromptBody,
} from "@/utils/actions/rule.validation";
import { aiPromptToRules } from "@/utils/ai/rule/prompt-to-rules";
import { aiDiffRules } from "@/utils/ai/rule/diff-rules";
import { aiFindExistingRules } from "@/utils/ai/rule/find-existing-rules";
import { aiGenerateRulesPrompt } from "@/utils/ai/rule/generate-rules-prompt";
import { aiFindSnippets } from "@/utils/ai/snippets/find-snippets";
import { createRule, updateRule, deleteRule } from "@/utils/rule/rule";
import { actionClient } from "@/utils/actions/safe-action";
import { getEmailAccountWithAi } from "@/utils/user/get";
import { SafeError } from "@/utils/error";
import { createEmailProvider } from "@/utils/email/provider";
import { aiPromptToRulesOld } from "@/utils/ai/rule/prompt-to-rules-old";
import type { CreateRuleResult } from "@/utils/rule/types";

export const runRulesAction = actionClient
  .metadata({ name: "runRules" })
  .inputSchema(runRulesBody)
  .action(
    async ({
      ctx: { emailAccountId, provider, logger: ctxLogger },
      parsedInput: { messageId, threadId, rerun, isTest },
    }): Promise<RunRulesResult[]> => {
      const logger = ctxLogger.with({ messageId, threadId });

      const emailAccount = await getEmailAccountWithAi({ emailAccountId });

      if (!emailAccount) throw new SafeError("Email account not found");
      if (!provider) throw new SafeError("Provider not found");

      const emailProvider = await createEmailProvider({
        emailAccountId,
        provider,
        logger,
      });
      const message = await emailProvider.getMessage(messageId);

      const fetchExecutedRule = !isTest && !rerun;

      const executedRules = fetchExecutedRule
        ? await prisma.executedRule.findMany({
          where: {
            emailAccountId,
            threadId,
            messageId,
          },
          select: {
            id: true,
            reason: true,
            actionItems: true,
            rule: true,
            createdAt: true,
            status: true,
          },
        })
        : [];

      if (executedRules.length > 0) {
        logger.info("Skipping. Rule already exists.");

        return executedRules.map((executedRule) => ({
          rule: executedRule.rule,
          actionItems: executedRule.actionItems,
          reason: executedRule.reason,
          existing: true,
          createdAt: executedRule.createdAt,
          status: executedRule.status,
        }));
      }

      const rules = await prisma.rule.findMany({
        where: {
          emailAccountId,
          enabled: true,
        },
        include: { actions: true },
      });

      const result = await runRules({
        isTest,
        provider: emailProvider,
        message: message as any,
        rules: rules as any,
        emailAccount,
        logger,
        modelType: "chat",
      });

      return result;
    },
  );

export const testAiCustomContentAction = actionClient
  .metadata({ name: "testAiCustomContent" })
  .inputSchema(testAiCustomContentBody)
  .action(
    async ({
      ctx: { emailAccountId, provider, logger },
      parsedInput: { content },
    }) => {
      const emailAccount = await getEmailAccountWithAi({ emailAccountId });

      if (!emailAccount) throw new SafeError("Email account not found");

      const emailProvider = await createEmailProvider({
        emailAccountId,
        provider,
        logger,
      });

      const rules = await prisma.rule.findMany({
        where: {
          emailAccountId,
          enabled: true,
          instructions: { not: null },
        },
        include: { actions: true },
      });

      const message = {
        id: `testMessageId-${Date.now()}`,
        threadId: `testThreadId-${Date.now()}`,
        snippet: content,
        textPlain: content,
        headers: {
          date: new Date().toISOString(),
          from: "",
          to: "",
          subject: "",
        },
        historyId: "",
        inline: [],
        internalDate: new Date().toISOString(),
        subject: "",
        date: new Date().toISOString(),
      };

      const result = await runRules({
        isTest: true,
        provider: emailProvider,
        message: message as any,
        rules: rules as any,
        emailAccount,
        logger,
        modelType: "chat",
      });

      return result;
    },
  );

export const setRuleRunOnThreadsAction = actionClient
  .metadata({ name: "setRuleRunOnThreads" })
  .inputSchema(z.object({ ruleId: z.string(), runOnThreads: z.boolean() }))
  .action(
    async ({
      ctx: { emailAccountId },
      parsedInput: { ruleId, runOnThreads },
    }) => {
      await prisma.rule.update({
        where: { id: ruleId, emailAccountId },
        data: { runOnThreads },
      });
    },
  );
