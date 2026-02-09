import type { CreateOrUpdateRuleSchema } from "@/features/rules/ai/prompts/create-rule-schema";
import prisma from "@/server/db/client";
import type { Logger } from "@/server/lib/logger";
import { ActionType } from "@/generated/prisma/enums";
import type { SystemType } from "@/generated/prisma/enums";
import type { Prisma, Rule } from "@/generated/prisma/client";
import { getActionRiskLevel, type RiskAction } from "@/server/lib/risk";

import { createRuleHistory } from "@/features/rules/rule-history";
import { isMicrosoftProvider } from "@/features/email/provider-types";
import { createEmailProvider } from "@/features/email/provider";
import { resolveLabelNameAndId } from "@/server/lib/label/resolve-label";
import { applyTaskPreferencePayloadsForEmailAccount } from "@/features/preferences/service";

export function partialUpdateRule({
  ruleId,
  data,
}: {
  ruleId: string;
  data: Partial<Rule>;
}) {
  return prisma.rule.update({
    where: { id: ruleId },
    data,
    include: { actions: true, group: true },
  });
}

export async function createRule({
  result,
  emailAccountId,
  systemType,
  provider,
  runOnThreads,
  logger,
}: {
  result: CreateOrUpdateRuleSchema;
  emailAccountId: string;
  systemType?: SystemType | null;
  provider: string;
  runOnThreads: boolean;
  logger: Logger;
}) {
  try {
    logger.info("Creating rule", {
      name: result.name,
      systemType,
    });

    const groupId = await resolveGroupId({
      emailAccountId,
      groupName: result.condition.group,
    });

    const { filteredActions, preferencePayloads } =
      splitTaskPreferenceActions(result.actions);
    const mappedActions = await mapActionFields(
      filteredActions,
      provider,
      emailAccountId,
      logger,
    );

    const rule = await prisma.rule.create({
      data: {
        name: result.name,
        emailAccountId,
        systemType,
        isTemporary: Boolean(result.expiresAt),
        expiresAt: result.expiresAt ? new Date(result.expiresAt) : null,
        actions: { createMany: { data: mappedActions } },
        enabled: shouldEnable(
          result,
          mappedActions.map((a) => ({
            type: a.type,
            subject: a.subject ?? null,
            content: a.content ?? null,
            to: a.to ?? null,
            cc: a.cc ?? null,
            bcc: a.bcc ?? null,
          })),
        ),
        runOnThreads,
        conditionalOperator: result.condition.conditionalOperator ?? undefined,
        instructions: result.condition.aiInstructions,
        from: result.condition.static?.from,
        to: result.condition.static?.to,
        subject: result.condition.static?.subject,
        groupId,
      },
      include: { actions: true, group: true },
    });

    await createRuleHistory({ rule, triggerType: "created" });

    if (preferencePayloads.length > 0) {
      await applyTaskPreferencePayloadsForEmailAccount({
        emailAccountId,
        payloads: preferencePayloads,
        logger,
      });
    }

    return rule;
  } catch (error) {
    logger.error("Error creating rule", { error });
    throw error;
  }
}

export async function updateRule({
  ruleId,
  result,
  emailAccountId,
  provider,
  logger,
  runOnThreads,
}: {
  ruleId: string;
  result: CreateOrUpdateRuleSchema;
  emailAccountId: string;
  provider: string;
  logger: Logger;
  runOnThreads?: boolean;
}) {
  try {
    logger.info("Updating rule", {
      name: result.name,
      ruleId,
    });

    const groupId = await resolveGroupId({
      emailAccountId,
      groupName: result.condition.group,
    });

    const { filteredActions, preferencePayloads } =
      splitTaskPreferenceActions(result.actions);

    const rule = await prisma.rule.update({
      where: { id: ruleId },
      data: {
        name: result.name,
        emailAccountId,
        ...(result.expiresAt !== undefined && {
          expiresAt: result.expiresAt ? new Date(result.expiresAt) : null,
          isTemporary: Boolean(result.expiresAt),
        }),
        // NOTE: this is safe for now as `Action` doesn't have relations
        // but if we add relations to `Action`, we would need to `update` here instead of `deleteMany` and `createMany` to avoid cascading deletes
        actions: {
          deleteMany: {},
          createMany: {
            data: await mapActionFields(
              filteredActions,
              provider,
              emailAccountId,
              logger,
            ),
          },
        },
        conditionalOperator: result.condition.conditionalOperator ?? undefined,
        instructions: result.condition.aiInstructions,
        from: result.condition.static?.from,
        to: result.condition.static?.to,
        subject: result.condition.static?.subject,
        ...(groupId !== undefined && { groupId }),
        ...(runOnThreads !== undefined && { runOnThreads }),
      },
      include: { actions: true, group: true },
    });

    await createRuleHistory({ rule, triggerType: "updated" });

    if (preferencePayloads.length > 0) {
      await applyTaskPreferencePayloadsForEmailAccount({
        emailAccountId,
        payloads: preferencePayloads,
        logger,
      });
    }

    return rule;
  } catch (error) {
    logger.error("Error updating rule", { error });
    throw error;
  }
}

async function resolveGroupId({
  emailAccountId,
  groupName,
}: {
  emailAccountId: string;
  groupName?: string | null;
}): Promise<string | null | undefined> {
  if (groupName === null) return null;
  if (!groupName) return undefined;

  const group = await prisma.group.findFirst({
    where: {
      emailAccountId,
      name: groupName,
    },
  });

  if (!group) {
    throw new Error(`Group not found: ${groupName}`);
  }

  return group.id;
}

export async function upsertSystemRule({
  name,
  instructions,
  actions,
  emailAccountId,
  systemType,
  runOnThreads,
  logger,
}: {
  name: string;
  instructions: string;
  actions: Prisma.ActionCreateManyRuleInput[];
  emailAccountId: string;
  systemType: SystemType;
  runOnThreads: boolean;
  logger: Logger;
}) {
  logger.info("Upserting system rule", { name, systemType });

  const existingRule = await prisma.rule.findFirst({
    where: {
      emailAccountId,
      OR: [{ systemType }, { name }],
    },
    include: { actions: true, group: true },
  });

  const data = {
    name,
    instructions,
    systemType,
    runOnThreads,
  };

  if (existingRule) {
    logger.info("Updating existing rule", {
      ruleId: existingRule.id,
      hadSystemType: !!existingRule.systemType,
    });

    const rule = await prisma.rule.update({
      where: { id: existingRule.id },
      data: {
        ...data,
        actions: {
          deleteMany: {},
          createMany: { data: actions },
        },
      },
      include: { actions: true, group: true },
    });

    await createRuleHistory({ rule, triggerType: "updated" });
    return rule;
  } else {
    logger.info("Creating new system rule");

    const rule = await prisma.rule.create({
      data: {
        ...data,
        enabled: true,
        emailAccountId,
        actions: { createMany: { data: actions } },
      },
      include: { actions: true, group: true },
    });

    await createRuleHistory({ rule, triggerType: "created" });
    return rule;
  }
}

export async function updateRuleActions({
  ruleId,
  actions,
  provider,
  emailAccountId,
  logger,
}: {
  ruleId: string;
  actions: CreateOrUpdateRuleSchema["actions"];
  provider: string;
  emailAccountId: string;
  logger: Logger;
}) {
  return prisma.rule.update({
    where: { id: ruleId },
    data: {
      actions: {
        deleteMany: {},
        createMany: {
          data: await mapActionFields(
            actions,
            provider,
            emailAccountId,
            logger,
          ),
        },
      },
    },
  });
}

export async function deleteRule({
  emailAccountId,
  ruleId,
  groupId,
}: {
  emailAccountId: string;
  ruleId: string;
  groupId?: string | null;
}) {
  return Promise.all([
    prisma.rule.delete({ where: { id: ruleId, emailAccountId } }),
    // in the future, we can make this a cascade delete, but we need to change the schema for this to happen
    groupId
      ? prisma.group.delete({ where: { id: groupId, emailAccountId } })
      : null,
  ]);
}

function shouldEnable(rule: CreateOrUpdateRuleSchema, actions: RiskAction[]) {
  // Don't automate if it's an example rule that should have been edited by the user
  if (false)
    return false;

  // Don't automate sending or replying to emails
  if (
    rule.actions.find(
      (a) => a.type === ActionType.REPLY || a.type === ActionType.SEND_EMAIL,
    )
  )
    return false;

  const riskLevels = actions.map(
    (action) => getActionRiskLevel(action, {}).level,
  );
  // Only enable if all actions are low risk
  return riskLevels.every((level) => level === "low");
}

async function mapActionFields(
  actions: (CreateOrUpdateRuleSchema["actions"][number] & {
    labelId?: string | null;
    folderId?: string | null;
  })[],
  provider: string,
  emailAccountId: string,
  logger: Logger,
) {
  const actionPromises = actions.map(
    async (a): Promise<Prisma.ActionCreateManyRuleInput> => {
      let label = a.fields?.label;
      let labelId: string | null = null;
      const folderName =
        typeof a.fields?.folderName === "string" ? a.fields.folderName : null;
      let folderId: string | null = a.folderId || null;

      if (a.type === ActionType.LABEL) {
        const emailProvider = await createEmailProvider({
          emailAccountId,
          provider,
          logger,
        });

        const resolved = await resolveLabelNameAndId({
          emailProvider,
          label: a.fields?.label || null,
          labelId: a.labelId || null,
        });
        label = resolved.label;
        labelId = resolved.labelId;
      }

      if (
        a.type === ActionType.MOVE_FOLDER &&
        folderName &&
        !folderId &&
        isMicrosoftProvider(provider)
      ) {
        const emailProvider = await createEmailProvider({
          emailAccountId,
          provider,
          logger,
        });

        folderId = await emailProvider.getOrCreateFolderIdByName(folderName);
      }

      const payload =
        a.fields?.payload === null || a.fields?.payload === undefined
          ? undefined
          : (a.fields.payload as Prisma.InputJsonValue);

      return {
        type: a.type,
        label,
        labelId,
        to: a.fields?.to,
        cc: a.fields?.cc,
        bcc: a.fields?.bcc,
        subject: a.fields?.subject,
        content: a.fields?.content,
        url: a.fields?.webhookUrl,
        payload,
        ...(isMicrosoftProvider(provider) && {
          folderName: folderName ?? null,
          folderId,
        }),
        delayInMinutes: a.delayInMinutes,
      };
    },
  );

  return Promise.all(actionPromises);
}

function splitTaskPreferenceActions(
  actions: CreateOrUpdateRuleSchema["actions"],
) {
  const preferencePayloads: unknown[] = [];
  const filteredActions = actions.filter((action) => {
    if (action.type !== ActionType.SET_TASK_PREFERENCES) {
      return true;
    }
    const payload = action.fields?.payload ?? null;
    if (payload) {
      preferencePayloads.push(payload);
    }
    return false;
  });

  return { filteredActions, preferencePayloads };
}
