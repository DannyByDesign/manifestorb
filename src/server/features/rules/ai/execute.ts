import { runActionFunction } from "@/features/ai/actions";
import prisma from "@/server/db/client";
import type { Prisma } from "@/generated/prisma/client";
import { ExecutedRuleStatus, ActionType } from "@/generated/prisma/enums";
import type { Logger } from "@/server/lib/logger";
import type { ParsedMessage } from "@/server/types";
import { updateExecutedActionWithDraftId } from "@/features/rules/ai/draft-management";
import type { EmailProvider } from "@/features/email/types";
import { sendNotification } from "@/features/notifications/create";
import { getEmailAccountWithAi } from "@/server/lib/user/get";

const MODULE = "ai-execute-act";

type ExecutedRuleWithActionItems = Prisma.ExecutedRuleGetPayload<{
  include: { actionItems: true };
}>;

export async function executeAct({
  client,
  executedRule,
  userEmail,
  userId,
  emailAccountId,
  message,
  logger,
}: {
  client: EmailProvider;
  executedRule: ExecutedRuleWithActionItems;
  message: ParsedMessage;
  userEmail: string;
  userId: string;
  emailAccountId: string;
  logger: Logger;
}) {
  const log = logger.with({
    module: MODULE,
    executedRuleId: executedRule.id,
    ruleId: executedRule.ruleId,
    threadId: executedRule.threadId,
    messageId: executedRule.messageId,
  });

  for (const action of executedRule.actionItems) {
    try {
      const actionResult = await runActionFunction({
        client,
        email: message,
        action,
        userEmail,
        userId,
        emailAccountId,
        executedRule,
        logger: log,
      });

      if (action.type === ActionType.DRAFT_EMAIL && actionResult?.draftId) {
        await updateExecutedActionWithDraftId({
          actionId: action.id,
          draftId: actionResult.draftId,
          logger,
        });
      }

      if (
        action.type === ActionType.CREATE_CALENDAR_EVENT &&
        actionResult &&
        typeof actionResult === "object" &&
        "id" in actionResult
      ) {
        const emailAccount = await getEmailAccountWithAi({ emailAccountId });
        const rule =
          executedRule.ruleId
            ? await prisma.rule.findUnique({
                where: { id: executedRule.ruleId },
                select: { name: true },
              })
            : null;
        if (emailAccount) {
          sendNotification({
            context: {
              type: "calendar",
              source: rule?.name ?? "rule",
              title: "Calendar Event Created",
              detail: `Created a calendar event from email "${message.headers.subject ?? ""}"`,
              importance: "medium",
            },
            emailAccount,
            userId: emailAccount.userId,
            dedupeKey: `calendar-${executedRule.threadId}-${(actionResult as { id: string }).id}`,
            metadata: {
              threadId: executedRule.threadId,
              eventId: (actionResult as { id: string }).id,
              ruleName: rule?.name,
            },
          }).catch((err) =>
            log.warn("Failed to send notification", { error: err }),
          );
        }
      }
    } catch (error) {
      log.error("Error executing action", { error });
      await prisma.executedRule.update({
        where: { id: executedRule.id },
        data: { status: ExecutedRuleStatus.ERROR },
      });
      throw error;
    }
  }

  await prisma.executedRule
    .update({
      where: { id: executedRule.id },
      data: { status: ExecutedRuleStatus.APPLIED },
    })
    .then(() => {
      log.info("ExecutedRule status updated to APPLIED", {
        executedRuleId: executedRule.id,
      });
    })
    .catch((error) => {
      log.error("Failed to update executed rule", { error });
    });
}
