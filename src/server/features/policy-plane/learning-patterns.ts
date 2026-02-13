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
  const rule = await prisma.canonicalRule.findUnique({
    where: { id: params.ruleId, emailAccountId: params.emailAccountId },
    select: { id: true, name: true },
  });

  if (!rule) {
    params.logger.error("Rule not found", { ruleId: params.ruleId });
    return;
  }

  const groupId = await getOrCreateGroupForRule({
    emailAccountId: params.emailAccountId,
    ruleId: rule.id,
    ruleName: rule.name ?? `rule-${rule.id}`,
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
  logger: Logger;
}): Promise<string> {
  const existing = await prisma.group.findUnique({
    where: {
      name_emailAccountId: {
        name: params.ruleName,
        emailAccountId: params.emailAccountId,
      },
    },
    select: { id: true },
  });
  if (existing?.id) return existing.id;

  try {
    const group = await prisma.group.create({
      data: {
        emailAccountId: params.emailAccountId,
        name: params.ruleName,
      },
    });
    return group.id;
  } catch (error) {
    if (!isDuplicateError(error)) throw error;
  }

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

  return existingGroup.id;
}
