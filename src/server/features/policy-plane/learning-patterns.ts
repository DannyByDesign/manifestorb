import prisma from "@/server/db/client";
import type { Logger } from "@/server/lib/logger";
import { GroupItemType, type GroupItemSource } from "@/generated/prisma/enums";
import { isDuplicateError } from "@/server/db/client-helpers";

export async function saveLearnedPattern(params: {
  emailAccountId: string;
  from: string;
  ruleId: string;
  exclude?: boolean;
  logger: Logger;
  reason?: string | null;
  threadId?: string | null;
  messageId?: string | null;
  source?: GroupItemSource | null;
}) {
  const rule = await prisma.rule.findUnique({
    where: { id: params.ruleId, emailAccountId: params.emailAccountId },
    select: { id: true, name: true, groupId: true },
  });

  if (!rule) {
    params.logger.error("Rule not found", { ruleId: params.ruleId });
    return;
  }

  const groupId = await getOrCreateGroupForRule({
    emailAccountId: params.emailAccountId,
    ruleId: rule.id,
    ruleName: rule.name,
    existingGroupId: rule.groupId,
    logger: params.logger,
  });

  await prisma.groupItem.upsert({
    where: {
      groupId_type_value: {
        groupId,
        type: GroupItemType.FROM,
        value: params.from,
      },
    },
    update: {
      exclude: params.exclude ?? false,
      reason: params.reason,
      threadId: params.threadId,
      messageId: params.messageId,
      source: params.source,
    },
    create: {
      groupId,
      type: GroupItemType.FROM,
      value: params.from,
      exclude: params.exclude ?? false,
      reason: params.reason,
      threadId: params.threadId,
      messageId: params.messageId,
      source: params.source,
    },
  });
}

async function getOrCreateGroupForRule(params: {
  emailAccountId: string;
  ruleId: string;
  ruleName: string;
  existingGroupId: string | null;
  logger: Logger;
}): Promise<string> {
  if (params.existingGroupId) return params.existingGroupId;

  try {
    const group = await prisma.group.create({
      data: {
        emailAccountId: params.emailAccountId,
        name: params.ruleName,
        rule: { connect: { id: params.ruleId } },
      },
    });
    return group.id;
  } catch (error) {
    if (!isDuplicateError(error)) throw error;
  }

  const updatedRule = await prisma.rule.findUnique({
    where: { id: params.ruleId },
    select: { groupId: true },
  });
  if (updatedRule?.groupId) return updatedRule.groupId;

  const existingGroup = await prisma.group.findUnique({
    where: {
      name_emailAccountId: {
        name: params.ruleName,
        emailAccountId: params.emailAccountId,
      },
    },
    select: { id: true },
  });
  if (!existingGroup) {
    throw new Error(`Failed to create or find group for rule: ${params.ruleName}`);
  }

  await prisma.rule
    .update({
      where: { id: params.ruleId },
      data: { groupId: existingGroup.id },
    })
    .catch((error) => {
      params.logger.warn("Failed to link existing group to rule", {
        ruleId: params.ruleId,
        groupId: existingGroup.id,
        error,
      });
    });

  return existingGroup.id;
}
