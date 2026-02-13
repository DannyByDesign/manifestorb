import type { EmailProvider, EmailLabel } from "@/features/email/types";
import type { Logger } from "@/server/lib/logger";
import prisma from "@/server/db/client";
import {
  CONVERSATION_STATUS_TYPES,
  type ConversationStatus,
} from "./conversation-status-config";
import { getRuleLabel } from "@/server/features/policy-plane/system-config";
import { labelMessageAndSync } from "@/server/lib/label.server";

export type LabelIds = Record<
  ConversationStatus,
  {
    labelId: string | null;
    label: string | null;
  }
>;

export async function removeConflictingThreadStatusLabels({
  emailAccountId,
  threadId,
  systemType,
  provider,
  dbLabels: providedDbLabels,
  providerLabels: providedProviderLabels,
  logger,
}: {
  emailAccountId: string;
  threadId: string;
  systemType: ConversationStatus;
  provider: EmailProvider;
  dbLabels?: LabelIds;
  providerLabels?: EmailLabel[];
  logger: Logger;
}): Promise<void> {
  const [dbLabels, providerLabels] = await Promise.all([
    providedDbLabels ?? getLabelsFromDb(emailAccountId),
    providedProviderLabels ?? provider.getLabels(),
  ]);

  const removeLabelIds: string[] = [];
  const providerLabelIds = new Set(providerLabels.map((l) => l.id));

  for (const type of CONVERSATION_STATUS_TYPES) {
    if (type === systemType) continue;

    let label = dbLabels[type as ConversationStatus];

    // If DB has a label ID, verify it still exists in the provider
    // If not, fall back to looking up by name (label may have been recreated)
    if (label.labelId && !providerLabelIds.has(label.labelId)) {
      logger.warn("DB label ID not found in provider, looking up by name", {
        type,
        staleId: label.labelId,
      });
      label = { labelId: null, label: null };
    }

    if (!label.labelId && !label.label) {
      const l = providerLabels.find((l) => l.name === getRuleLabel(type));
      if (!l?.id) {
        continue;
      }
      label = {
        labelId: l.id,
        label: l.name,
      };
    }
    if (!label.labelId) {
      continue;
    }
    removeLabelIds.push(label.labelId);
  }

  if (removeLabelIds.length === 0) {
    logger.info("No conflicting labels to remove");
    return;
  }

  await provider.removeThreadLabels(threadId, removeLabelIds).catch((error) =>
    logger.error("Failed to remove conflicting thread labels", {
      removeLabelIds,
      error,
    }),
  );

  logger.info("Removed conflicting thread status labels", {
    removedCount: removeLabelIds.length,
  });
}

/**
 * Applies a thread status label to a message/thread.
 * 1. Removes other mutually exclusive thread status labels from the thread
 * 2. Adds the new label
 *
 * Used primarily for outbound reply tracking where we both remove and add.
 */
export async function applyThreadStatusLabel({
  emailAccountId,
  threadId,
  messageId,
  systemType,
  provider,
  logger,
}: {
  emailAccountId: string;
  threadId: string;
  messageId: string;
  systemType: ConversationStatus;
  provider: EmailProvider;
  logger: Logger;
}): Promise<void> {
  const [dbLabels, providerLabels] = await Promise.all([
    getLabelsFromDb(emailAccountId),
    provider.getLabels(),
  ]);

  const addLabel = async () => {
    let targetLabel = dbLabels[systemType];

    // If we don't have labelId from DB, fetch/create it
    if (!targetLabel.labelId) {
      const label =
        providerLabels.find((l) => l.name === getRuleLabel(systemType)) ||
        (await provider.createLabel(getRuleLabel(systemType)));
      if (label) {
        targetLabel = {
          labelId: label.id,
          label: label.name,
        };
      }
    }

    // Must have labelId to proceed
    if (!targetLabel.labelId) {
      logger.error("Failed to get or create target label", {
        systemType,
        labelName: getRuleLabel(systemType),
      });
      return;
    }

    return labelMessageAndSync({
      provider,
      messageId,
      labelId: targetLabel.labelId,
      labelName: targetLabel.label,
      emailAccountId,
      logger,
    }).catch((error) =>
      logger.error("Failed to apply thread status label", {
        labelId: targetLabel.labelId,
        labelName: targetLabel.label,
        error,
      }),
    );
  };

  await Promise.all([
    removeConflictingThreadStatusLabels({
      emailAccountId,
      threadId,
      systemType,
      provider,
      dbLabels,
      providerLabels,
      logger,
    }),
    addLabel(),
  ]);

  logger.info("Thread status label applied successfully");
}

export async function getLabelsFromDb(
  emailAccountId: string,
): Promise<LabelIds> {
  const rules = await prisma.canonicalRule.findMany({
    where: {
      emailAccountId,
      enabled: true,
    },
    select: {
      name: true,
      actionPlan: true,
    },
  });

  const dbLabels: LabelIds = {
    TO_REPLY: { labelId: null, label: null },
    AWAITING_REPLY: { labelId: null, label: null },
    FYI: { labelId: null, label: null },
    ACTIONED: { labelId: null, label: null },
  };

  const validStatuses = new Set(CONVERSATION_STATUS_TYPES);

  for (const rule of rules) {
    const normalizedName = rule.name?.trim().toUpperCase();
    if (!normalizedName || !validStatuses.has(normalizedName as ConversationStatus)) continue;

    const actionPlan =
      rule.actionPlan && typeof rule.actionPlan === "object" && !Array.isArray(rule.actionPlan)
        ? (rule.actionPlan as Record<string, unknown>)
        : {};
    const actions = Array.isArray(actionPlan.actions) ? actionPlan.actions : [];
    const labelAction = actions
      .map((action) =>
        action && typeof action === "object" && !Array.isArray(action)
          ? (action as Record<string, unknown>)
          : null,
      )
      .find((action) => {
        if (!action) return false;
        const type = typeof action.type === "string" ? action.type.toLowerCase() : "";
        return type === "label" || type === "apply_label";
      });

    if (!labelAction) continue;

    const labelId =
      typeof labelAction.labelId === "string" && labelAction.labelId.length > 0
        ? labelAction.labelId
        : null;
    const label =
      typeof labelAction.label === "string" && labelAction.label.length > 0
        ? labelAction.label
        : null;

    if (labelId || label) {
      dbLabels[normalizedName as ConversationStatus] = {
        labelId,
        label,
      };
    }
  }

  return dbLabels;
}
