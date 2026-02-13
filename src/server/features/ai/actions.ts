import { after } from "next/server";
import { ActionType } from "@/generated/prisma/enums";
import type { ExecutedRule } from "@/generated/prisma/client";
import type { Logger } from "@/server/lib/logger";
import { callWebhook } from "@/server/lib/webhook";
import type { ActionItem, EmailForAction } from "@/features/ai/types";
import type { EmailProvider } from "@/features/email/types";
import { enqueueDigestItem } from "@/features/digest/index";
import { filterNullProperties } from "@/server/lib";
import { labelMessageAndSync } from "@/server/lib/label.server";
import { hasVariables } from "@/server/lib/template";
import prisma from "@/server/db/client";
import { sendColdEmailNotification } from "@/features/cold-email/send-notification";
import { extractEmailAddress } from "@/server/integrations/google";
import { captureException } from "@/server/lib/error";
import { ensureEmailSendingEnabled } from "@/server/lib/mail";
import { getEmailAccountWithAi } from "@/server/lib/user/get";
import { scheduleTasksForUser } from "@/features/calendar/scheduling/TaskSchedulingService";
import { createCalendarProvider } from "@/features/ai/tools/providers/calendar";
import {
  resolveCalendarTimeZoneForRequest,
  resolveDefaultCalendarTimeZone,
} from "@/features/ai/tools/calendar-time";
import {
  formatDateTimeForUser,
  parseDateBoundInTimeZone,
} from "@/features/ai/tools/timezone";
import { ApprovalService, getApprovalExpiry } from "@/features/approvals/service";
import { createInAppNotification } from "@/features/notifications/create";
import { applyTaskPreferencePayloadsForUser } from "@/features/preferences/service";
import { evaluatePolicyDecision } from "@/server/features/policy-plane/pdp";
import { createPolicyExecutionLog } from "@/server/features/policy-plane/policy-logs";

const MODULE = "ai-actions";

type ActionFunction<T extends Record<string, unknown>> = (options: {
  client: EmailProvider;
  email: EmailForAction;
  args: T;
  userEmail: string;
  userId: string;
  emailAccountId: string;
  executedRule: ExecutedRule;
  logger: Logger;
}) => Promise<unknown>;

function parseDateOrNull(value: unknown): Date | null {
  if (typeof value !== "string" && typeof value !== "number" && !(value instanceof Date)) {
    return null;
  }
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function asPayloadObject(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

function asOptionalString(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

function asOptionalBoolean(value: unknown): boolean | undefined {
  return typeof value === "boolean" ? value : undefined;
}

function asOptionalNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

export const runActionFunction = async (options: {
  client: EmailProvider;
  email: EmailForAction;
  action: ActionItem;
  userEmail: string;
  userId: string;
  emailAccountId: string;
  executedRule: ExecutedRule;
  logger: Logger;
  policyBypass?: { approvalRequestId: string; reason: "approved_replay" };
  policySource?: "skills" | "planner" | "automation" | "scheduled";
}) => {
  const { action, userEmail, logger } = options;
  const log = logger.with({ module: MODULE });

  log.info("Running action", {
    actionType: action.type,
    userEmail,
    id: action.id,
  });
  log.trace("Running action", () => filterNullProperties(action));

  const { type, ...args } = action;
  const opts = {
    ...options,
    args,
    logger: log,
  };

  if (!options.policyBypass) {
    const policyContext = buildAutomationActionPolicyContext({
      action,
      email: options.email,
    });
    if (policyContext) {
      const decision = await evaluatePolicyDecision({
        userId: options.userId,
        emailAccountId: options.emailAccountId,
        toolName: policyContext.toolName,
        args: policyContext.args,
        context: {
          source: options.policySource ?? "automation",
          provider: "system",
          messageId: options.email.id,
          threadId: options.email.threadId,
        },
      });

      if (decision.kind === "require_approval" && decision.approval?.requiresApproval) {
        const approvalService = new ApprovalService(prisma);
        const expiresInSeconds = await getApprovalExpiry(options.userId);
        const idempotencyKey = [
          "automation-action",
          options.userId,
          options.executedRule.id,
          action.id,
        ].join(":");

        const approvalRequest = await approvalService.createRequest({
          userId: options.userId,
          provider: "web",
          externalContext: {
            source: "automation",
            threadId: options.email.threadId,
            messageId: options.email.id,
          },
          requestPayload: {
            actionType: "rule_action_execute",
            description:
              decision.approval.matchedRule?.name ??
              `Automation action ${action.type} requires approval`,
            tool: policyContext.toolName,
            args: policyContext.args,
            executedRuleId: options.executedRule.id,
            actionId: action.id,
            emailAccountId: options.emailAccountId,
            messageId: options.email.id,
            threadId: options.email.threadId,
          },
          idempotencyKey,
          expiresInSeconds,
        });

        try {
          await createInAppNotification({
            userId: options.userId,
            title: "Automation action requires approval",
            body: `Amodel blocked automation action ${action.type} until you approve it.`,
            type: "approval",
            dedupeKey: idempotencyKey,
            metadata: {
              approvalRequestId: approvalRequest.id,
              executedRuleId: options.executedRule.id,
              actionId: action.id,
              actionType: action.type,
              messageId: options.email.id,
              threadId: options.email.threadId,
            },
          });
        } catch (notificationError) {
          log.warn("Failed to create in-app notification for automation approval", {
            error: notificationError,
            approvalRequestId: approvalRequest.id,
          });
        }

        await createPolicyExecutionLog({
          userId: options.userId,
          emailAccountId: options.emailAccountId,
          source: options.policySource ?? "automation",
          toolName: policyContext.toolName,
          mutationResource:
            typeof policyContext.args.resource === "string"
              ? policyContext.args.resource
              : undefined,
          mutationOperation:
            typeof policyContext.args.operation === "string"
              ? policyContext.args.operation
              : undefined,
          args: policyContext.args,
          outcome: "deferred_approval",
          result: { approvalRequestId: approvalRequest.id },
          threadId: options.email.threadId,
          messageId: options.email.id,
        });

        return {
          approvalRequested: true,
          approvalRequestId: approvalRequest.id,
          blockedReason: decision.message,
        };
      }

      if (decision.kind === "block") {
        await createPolicyExecutionLog({
          userId: options.userId,
          emailAccountId: options.emailAccountId,
          source: options.policySource ?? "automation",
          toolName: policyContext.toolName,
          mutationResource:
            typeof policyContext.args.resource === "string"
              ? policyContext.args.resource
              : undefined,
          mutationOperation:
            typeof policyContext.args.operation === "string"
              ? policyContext.args.operation
              : undefined,
          args: policyContext.args,
          outcome: "blocked",
          error: decision.message,
          threadId: options.email.threadId,
          messageId: options.email.id,
        });
        return {
          blockedByPolicy: true,
          blockedReason: decision.message,
        };
      }
    }
  }

  let executionResult: unknown;
  try {
    switch (type) {
      case ActionType.ARCHIVE:
        executionResult = await archive(opts);
        break;
      case ActionType.LABEL:
        executionResult = await label(opts);
        break;
      case ActionType.DRAFT_EMAIL:
        executionResult = await draft(opts);
        break;
      case ActionType.REPLY:
        ensureEmailSendingEnabled();
        executionResult = await reply(opts);
        break;
      case ActionType.SEND_EMAIL:
        ensureEmailSendingEnabled();
        executionResult = await send_email(opts);
        break;
      case ActionType.FORWARD:
        ensureEmailSendingEnabled();
        executionResult = await forward(opts);
        break;
      case ActionType.MARK_SPAM:
        executionResult = await mark_spam(opts);
        break;
      case ActionType.CALL_WEBHOOK:
        executionResult = await call_webhook(opts);
        break;
      case ActionType.MARK_READ:
        executionResult = await mark_read(opts);
        break;
      case ActionType.DIGEST:
        executionResult = await digest(opts);
        break;
      case ActionType.MOVE_FOLDER:
        executionResult = await move_folder(opts);
        break;
      case ActionType.NOTIFY_SENDER:
        executionResult = await notify_sender(opts);
        break;
      case ActionType.NOTIFY_USER:
        executionResult = await notify_user(opts);
        break;
      case ActionType.SET_TASK_PREFERENCES:
        executionResult = await set_task_preferences(opts);
        break;
      case ActionType.CREATE_TASK:
        executionResult = await create_task(opts);
        break;
      case ActionType.CREATE_CALENDAR_EVENT:
        executionResult = await create_calendar_event(opts);
        break;
      case ActionType.SCHEDULE_MEETING:
        executionResult = await schedule_meeting(opts);
        break;
      default: {
        await import("./actions/register-defaults");
        const { getAction } = await import("./actions/registry");
        const registered = getAction(String(type));
        if (!registered) {
          throw new Error(`Unknown action: ${action}`);
        }
        executionResult = await registered.execute(opts);
      }
    }
  } catch (error) {
    await createPolicyExecutionLog({
      userId: options.userId,
      emailAccountId: options.emailAccountId,
      source: options.policySource ?? "automation",
      toolName: options.policyBypass ? "approved_replay" : "action_execution",
      mutationResource: "email",
      mutationOperation: String(type).toLowerCase(),
      args: {
        actionType: type,
        actionId: action.id,
        messageId: options.email.id,
        threadId: options.email.threadId,
      },
      outcome: "failed",
      error: error instanceof Error ? error.message : String(error),
      threadId: options.email.threadId,
      messageId: options.email.id,
    });
    throw error;
  }

  await createPolicyExecutionLog({
    userId: options.userId,
    emailAccountId: options.emailAccountId,
    source: options.policySource ?? "automation",
    toolName: options.policyBypass ? "approved_replay" : "action_execution",
    mutationResource: "email",
    mutationOperation: String(type).toLowerCase(),
    args: {
      actionType: type,
      actionId: action.id,
      messageId: options.email.id,
      threadId: options.email.threadId,
    },
    outcome: "executed",
    result:
      executionResult && typeof executionResult === "object"
        ? (executionResult as Record<string, unknown>)
        : { value: executionResult },
    threadId: options.email.threadId,
    messageId: options.email.id,
  });

  return executionResult;
};

function parseCommaSeparatedEmails(value: string | null | undefined): string[] {
  if (!value) return [];
  return value
    .split(",")
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0);
}

function buildAutomationActionPolicyContext(params: {
  action: ActionItem;
  email: EmailForAction;
}): { toolName: string; args: Record<string, unknown> } | null {
  const { action, email } = params;
  const recipientEmails = [
    ...parseCommaSeparatedEmails(action.to),
    ...parseCommaSeparatedEmails(action.cc),
    ...parseCommaSeparatedEmails(action.bcc),
  ];

  const baseArgs = {
    resource: "email",
    ids: [email.threadId],
  };

  switch (action.type) {
    case ActionType.REPLY:
    case ActionType.SEND_EMAIL:
    case ActionType.FORWARD:
    case ActionType.NOTIFY_SENDER:
      return {
        toolName: "send",
        args: {
          resource: "email",
          to: recipientEmails,
          operation: "send_email",
        },
      };
    case ActionType.DRAFT_EMAIL:
      return {
        toolName: "create",
        args: {
          resource: "email",
          to: recipientEmails,
          operation: "create_email_draft",
        },
      };
    case ActionType.CREATE_CALENDAR_EVENT:
      return {
        toolName: "create",
        args: {
          resource: "calendar",
          to: recipientEmails,
          operation: "create_calendar_event",
        },
      };
    case ActionType.CREATE_TASK:
      return {
        toolName: "create",
        args: {
          resource: "task",
          operation: "create_task",
        },
      };
    case ActionType.ARCHIVE:
      return { toolName: "modify", args: { ...baseArgs, operation: "archive_email" } };
    case ActionType.MARK_SPAM:
      return { toolName: "modify", args: { ...baseArgs, operation: "trash_email" } };
    case ActionType.MARK_READ:
    case ActionType.LABEL:
    case ActionType.MOVE_FOLDER:
      return { toolName: "modify", args: { ...baseArgs, operation: "update_email" } };
    case ActionType.SET_TASK_PREFERENCES:
      return {
        toolName: "modify",
        args: {
          resource: "preferences",
          operation: "update_preferences",
        },
      };
    case ActionType.CALL_WEBHOOK:
      return {
        toolName: "modify",
        args: {
          resource: "workflow",
          operation: "run_workflow",
        },
      };
    case ActionType.SCHEDULE_MEETING:
    case ActionType.DIGEST:
    case ActionType.NOTIFY_USER:
      return null;
    default:
      return {
        toolName: "modify",
        args: { ...baseArgs, operation: "update_email" },
      };
  }
}

const archive: ActionFunction<Record<string, unknown>> = async ({
  client,
  email,
  userEmail,
}) => {
  await client.archiveThread(email.threadId, userEmail);
};

const label: ActionFunction<{
  label?: string | null;
  labelId?: string | null;
}> = async ({ client, email, args, emailAccountId, logger }) => {
  logger.info("Label action started", {
    label: args.label,
    labelId: args.labelId,
  });

  const originalLabelId = args.labelId;
  let labelIdToUse = originalLabelId;

  if (!labelIdToUse && args.label) {
    if (hasVariables(args.label)) {
      logger.error("Template label not processed by AI", { label: args.label });
      return;
    }

    const matchingLabel = await client.getLabelByName(args.label);

    if (matchingLabel) {
      labelIdToUse = matchingLabel.id;
    } else {
      logger.info("Label not found, creating it", { labelName: args.label });
      const createdLabel = await client.createLabel(args.label);
      labelIdToUse = createdLabel.id;

      if (!labelIdToUse) {
        logger.error("Failed to create label", { labelName: args.label });
        return;
      }
    }
  }

  if (!labelIdToUse) return;

  await labelMessageAndSync({
    provider: client,
    messageId: email.id,
    labelId: labelIdToUse,
    labelName: args.label || null,
    emailAccountId,
    logger,
  });

  if (!originalLabelId && labelIdToUse && args.label) {
    after(() =>
      lazyUpdateActionLabelId({
        labelName: args.label!,
        labelId: labelIdToUse!,
        emailAccountId,
        logger,
      }),
    );
  }
};

const draft: ActionFunction<{
  subject?: string | null;
  content?: string | null;
  to?: string | null;
  cc?: string | null;
  bcc?: string | null;
}> = async ({ client, email, args, userEmail, executedRule }) => {
  const draftArgs = {
    to: args.to ?? undefined,
    subject: args.subject ?? undefined,
    content: args.content ?? "",
    cc: args.cc ?? undefined,
    bcc: args.bcc ?? undefined,
  };

  const result = await client.draftEmail(
    {
      id: email.id,
      threadId: email.threadId,
      headers: email.headers,
      internalDate: email.internalDate,
      snippet: "",
      historyId: "",
      inline: [],
      subject: email.headers.subject,
      date: email.headers.date,
      labelIds: [],
      textPlain: email.textPlain,
      textHtml: email.textHtml,
      attachments: email.attachments,
    },
    draftArgs,
    userEmail,
    executedRule,
  );
  return { draftId: result.draftId };
};

const reply: ActionFunction<{
  content?: string | null;
  cc?: string | null;
  bcc?: string | null;
}> = async ({ client, email, args }) => {
  if (!args.content) return;

  await client.replyToEmail(
    {
      id: email.id,
      threadId: email.threadId,
      headers: email.headers,
      internalDate: email.internalDate,
      snippet: "",
      historyId: "",
      inline: [],
      subject: email.headers.subject,
      date: email.headers.date,
      textPlain: email.textPlain,
      textHtml: email.textHtml,
    },
    args.content,
  );
};

const send_email: ActionFunction<{
  subject?: string | null;
  content?: string | null;
  to?: string | null;
  cc?: string | null;
  bcc?: string | null;
}> = async ({ client, args }) => {
  if (!args.to || !args.subject || !args.content) return;

  const emailArgs = {
    to: args.to,
    cc: args.cc ?? undefined,
    bcc: args.bcc ?? undefined,
    subject: args.subject,
    messageText: args.content,
  };

  await client.sendEmail(emailArgs);
};

const forward: ActionFunction<{
  content?: string | null;
  to?: string | null;
  cc?: string | null;
  bcc?: string | null;
}> = async ({ client, email, args }) => {
  if (!args.to) return;

  const forwardArgs = {
    messageId: email.id,
    to: args.to,
    cc: args.cc ?? undefined,
    bcc: args.bcc ?? undefined,
    content: args.content ?? undefined,
  };

  await client.forwardEmail(
    {
      id: email.id,
      threadId: email.threadId,
      headers: email.headers,
      internalDate: email.internalDate,
      snippet: "",
      historyId: "",
      inline: [],
      subject: email.headers.subject,
      date: email.headers.date,
    },
    forwardArgs,
  );
};

const mark_spam: ActionFunction<Record<string, unknown>> = async ({
  client,
  email,
}) => {
  await client.markSpam(email.threadId);
};

const call_webhook: ActionFunction<{ url?: string | null }> = async ({
  email,
  args,
  userId,
  executedRule,
}) => {
  if (!args.url) return;

  const payload = {
    email: {
      threadId: email.threadId,
      messageId: email.id,
      subject: email.headers.subject,
      from: email.headers.from,
      cc: email.headers.cc,
      bcc: email.headers.bcc,
      headerMessageId: email.headers["message-id"] || "",
    },
    executedRule: {
      id: executedRule.id,
      ruleId: executedRule.ruleId,
      reason: executedRule.reason,
      automated: executedRule.automated,
      createdAt: executedRule.createdAt,
    },
  };

  await callWebhook(userId, args.url, payload);
};

const mark_read: ActionFunction<Record<string, unknown>> = async ({
  client,
  email,
}) => {
  await client.markRead(email.threadId);
};

const digest: ActionFunction<{ id?: string }> = async ({
  email,
  emailAccountId,
  args,
  logger,
}) => {
  if (!args.id) return;
  const actionId = args.id;
  await enqueueDigestItem({ email, emailAccountId, actionId, logger });
};

const move_folder: ActionFunction<{
  folderId?: string | null;
  folderName?: string | null;
}> = async ({ client, email, userEmail, emailAccountId, args, logger }) => {
  const originalFolderId = args.folderId;
  let folderIdToUse = originalFolderId;

  // resolve folder name to ID if needed (similar to label resolution)
  if (!folderIdToUse && args.folderName) {
    if (hasVariables(args.folderName)) {
      logger.error("Template folder name not processed by AI", {
        folderName: args.folderName,
      });
      return;
    }

    logger.info("Resolving folder name to ID", { folderName: args.folderName });
    folderIdToUse = await client.getOrCreateFolderIdByName(args.folderName);

    if (!folderIdToUse) {
      logger.error("Failed to resolve folder", { folderName: args.folderName });
      return;
    }
  }

  if (!folderIdToUse) return;

  await client.moveThreadToFolder(email.threadId, userEmail, folderIdToUse);

  // lazy-update the folderId in the database for future runs
  if (!originalFolderId && folderIdToUse && args.folderName) {
    after(() =>
      lazyUpdateActionFolderId({
        folderName: args.folderName!,
        folderId: folderIdToUse!,
        emailAccountId,
        logger,
      }),
    );
  }
};

const notify_sender: ActionFunction<Record<string, unknown>> = async ({
  email,
  emailAccountId,
  userEmail,
  logger,
}) => {
  const senderEmail = extractEmailAddress(email.headers.from);
  if (!senderEmail) {
    logger.error("Could not extract sender email for notify_sender action");
    return;
  }

  const result = await sendColdEmailNotification({
    senderEmail,
    recipientEmail: userEmail,
    originalSubject: email.headers.subject,
    originalMessageId: email.headers["message-id"],
    logger,
  });

  if (!result.success) {
    // Best-effort: don't fail the whole rule run if notification can't be sent.
    logger.error("Cold email notification failed", {
      senderEmail,
      error: result.error,
    });

    captureException(
      new Error(result.error ?? "Cold email notification failed"),
      {
        emailAccountId,
        extra: { actionType: ActionType.NOTIFY_SENDER },
        sampleRate: 0.01,
      },
    );
    return;
  }
};

export const notify_user: ActionFunction<Record<string, unknown>> = async ({
  email,
  userId,
  emailAccountId,
  logger,
}) => {
  try {
    const { generateNotification } = await import(
      "@/features/notifications/generator"
    );
    const { createInAppNotification } = await import(
      "@/features/notifications/create"
    );

    const fromName =
      extractEmailAddress(email.headers.from) || email.headers.from;
    const subject = email.headers.subject || "(No Subject)";
    const snippet = email.snippet || email.textPlain?.substring(0, 150) || "";

    // Get email account for AI notification generation
    const emailAccount = await getEmailAccountWithAi({ emailAccountId });
    if (!emailAccount) {
      logger.error("Could not find email account for notify_user action");
      return;
    }

    // Generate AI-powered notification text
    const text = await generateNotification(
      {
        type: "email",
        source: fromName,
        title: subject,
        detail: snippet,
        importance: "medium",
      },
      { emailAccount }
    );

    // Create in-app notification (with surfaces fallback via QStash)
    await createInAppNotification({
      userId,
      title: `New Email from ${fromName}`,
      body: text,
      type: "info",
      dedupeKey: `email-rule-${email.id}`,
      metadata: {
        messageId: email.id,
        threadId: email.threadId,
        emailAccountId,
      },
    });

    logger.info("Push notification sent via NOTIFY_USER action", {
      messageId: email.id,
      from: fromName,
    });
  } catch (error) {
    logger.error("Error sending push notification via NOTIFY_USER action", {
      error,
    });
    captureException(error instanceof Error ? error : new Error(String(error)), {
      emailAccountId,
      extra: { actionType: ActionType.NOTIFY_USER },
      sampleRate: 0.1,
    });
  }
};

const set_task_preferences: ActionFunction<{ payload?: ActionItem["payload"] }> = async ({
  userId,
  args,
  logger,
}) => {
  const payload = asPayloadObject(args.payload);
  if (!payload) {
    logger.warn("Missing payload for set_task_preferences action");
    return;
  }

  await applyTaskPreferencePayloadsForUser({
    userId,
    payloads: [payload],
    logger,
  });
};

const create_task: ActionFunction<{ payload?: ActionItem["payload"] }> = async ({
  userId,
  emailAccountId,
  args,
  logger,
}) => {
  const payload = asPayloadObject(args.payload);
  if (!payload) {
    logger.warn("Missing payload for create_task action");
    return;
  }

  const title = asOptionalString(payload.title);
  if (!title) {
    logger.warn("Task payload missing title", { payload });
    return;
  }
  const statusRaw = asOptionalString(payload.status);
  const status =
    statusRaw === "PENDING" ||
    statusRaw === "IN_PROGRESS" ||
    statusRaw === "COMPLETED" ||
    statusRaw === "CANCELLED"
      ? statusRaw
      : "PENDING";
  const priorityRaw = asOptionalString(payload.priority);
  const priority =
    priorityRaw === "NONE" ||
    priorityRaw === "LOW" ||
    priorityRaw === "MEDIUM" ||
    priorityRaw === "HIGH"
      ? priorityRaw
      : "NONE";
  const energyRaw = asOptionalString(payload.energyLevel);
  const energyLevel =
    energyRaw === "LOW" || energyRaw === "MEDIUM" || energyRaw === "HIGH"
      ? energyRaw
      : null;
  const preferredTimeRaw = asOptionalString(payload.preferredTime);
  const preferredTime =
    preferredTimeRaw === "MORNING" ||
    preferredTimeRaw === "AFTERNOON" ||
    preferredTimeRaw === "EVENING"
      ? preferredTimeRaw
      : null;
  const reschedulePolicyRaw = asOptionalString(payload.reschedulePolicy);
  const reschedulePolicy =
    reschedulePolicyRaw === "FIXED" ||
    reschedulePolicyRaw === "FLEXIBLE" ||
    reschedulePolicyRaw === "APPROVAL_REQUIRED"
      ? reschedulePolicyRaw
      : "FLEXIBLE";
  const task = await prisma.task.create({
    data: {
      userId,
      title,
      description: asOptionalString(payload.description) ?? null,
      durationMinutes: asOptionalNumber(payload.durationMinutes) ?? null,
      status,
      priority,
      energyLevel,
      preferredTime,
      dueDate: parseDateOrNull(payload.dueDate),
      startDate: parseDateOrNull(payload.startDate),
      isAutoScheduled: asOptionalBoolean(payload.isAutoScheduled) ?? true,
      scheduleLocked: asOptionalBoolean(payload.scheduleLocked) ?? false,
      reschedulePolicy,
    },
  });

  if (task.isAutoScheduled) {
    try {
      await scheduleTasksForUser({ userId, emailAccountId, source: "ai" });
    } catch (error) {
      logger.warn("Failed to schedule tasks after create_task action", { error });
    }
  }

  return task;
};

const create_calendar_event: ActionFunction<{ payload?: ActionItem["payload"] }> = async ({
  userId,
  emailAccountId,
  args,
  logger,
}) => {
  const payload = asPayloadObject(args.payload);
  if (!payload) {
    logger.warn("Missing payload for create_calendar_event action");
    return;
  }

  const start = asOptionalString(payload.start);
  const end = asOptionalString(payload.end);
  if (!start || !end) {
    logger.warn("Calendar event payload missing start/end", {
      payload,
    });
    return;
  }

  const title = asOptionalString(payload.title);
  if (!title) {
    logger.warn("Calendar event payload missing title", {
      payload,
    });
    return;
  }

  const defaultCalendarTimeZone = await resolveDefaultCalendarTimeZone({
    userId,
    emailAccountId,
  });
  if ("error" in defaultCalendarTimeZone) {
    logger.warn("Unable to resolve default calendar timezone for create_calendar_event", {
      error: defaultCalendarTimeZone.error,
      userId,
      emailAccountId,
    });
    return;
  }
  const effectiveTimeZone = resolveCalendarTimeZoneForRequest({
    requestedTimeZone: asOptionalString(payload.timeZone),
    defaultTimeZone: defaultCalendarTimeZone.timeZone,
  });
  if ("error" in effectiveTimeZone) {
    logger.warn("Invalid requested timezone for create_calendar_event", {
      error: effectiveTimeZone.error,
      payload,
      userId,
      emailAccountId,
    });
    return;
  }
  const parsedStart = parseDateBoundInTimeZone(
    start,
    effectiveTimeZone.timeZone,
    "start",
  );
  const parsedEnd = parseDateBoundInTimeZone(
    end,
    effectiveTimeZone.timeZone,
    "end",
  );
  if (!parsedStart || !parsedEnd) {
    logger.warn("Invalid calendar event payload date/time", {
      payload,
      resolvedTimeZone: effectiveTimeZone.timeZone,
    });
    return;
  }

  const calendarProvider = await createCalendarProvider(
    { id: emailAccountId },
    userId,
    logger,
  );

  const event = await calendarProvider.createEvent({
    calendarId: asOptionalString(payload.calendarId),
    input: {
      title,
      description: asOptionalString(payload.description),
      start: parsedStart,
      end: parsedEnd,
      allDay: asOptionalBoolean(payload.allDay),
      isRecurring: asOptionalBoolean(payload.isRecurring),
      recurrenceRule: asOptionalString(payload.recurrenceRule),
      timeZone: effectiveTimeZone.timeZone,
      location: asOptionalString(payload.location),
    },
  });

  try {
    await scheduleTasksForUser({ userId, emailAccountId, source: "ai" });
  } catch (error) {
    logger.warn("Failed to schedule tasks after create_calendar_event action", {
      error,
    });
  }

  return event;
};

/**
 * Proactive SCHEDULE_MEETING action:
 * 1. Finds available calendar slots
 * 2. Drafts a reply to the sender proposing meeting times
 * 3. Creates a single approval request with slots + draft
 * 4. Sends a rich notification for one-tap approval
 */
export const schedule_meeting: ActionFunction<Record<string, unknown>> = async ({
  client,
  email,
  userId,
  emailAccountId,
  logger,
}) => {
  const senderEmail =
    extractEmailAddress(email.headers.from) || email.headers.from;
  const subject = email.headers.subject || "(No Subject)";

  const [prefs, insights] = await Promise.all([
    prisma.taskPreference.findUnique({
      where: { userId },
      select: {
        defaultMeetingDurationMin: true,
        meetingSlotCount: true,
        meetingExpirySeconds: true,
      },
    }),
    prisma.schedulingInsights.findUnique({
      where: { userId },
      select: { medianMeetingDurationMin: true },
    }),
  ]);
  const durationMinutes =
    prefs?.defaultMeetingDurationMin ??
    (insights?.medianMeetingDurationMin != null
      ? Math.round(insights.medianMeetingDurationMin)
      : undefined) ??
    30;
  const slotCount = prefs?.meetingSlotCount ?? 3;
  const expirySeconds = prefs?.meetingExpirySeconds ?? 86_400;

  // 1. Find available calendar slots
  let slots: Array<{ start: Date; end: Date; score: number }> = [];
  try {
    const calendarProvider = await createCalendarProvider(
      { id: emailAccountId },
      userId,
      logger,
    );
    const allSlots = await calendarProvider.findAvailableSlots({
      durationMinutes,
    });
    slots = allSlots.slice(0, slotCount);
  } catch (error) {
    logger.warn("SCHEDULE_MEETING: calendar not connected or no slots", {
      error,
    });
  }

  if (slots.length === 0) {
    // Graceful degradation: send a plain notification
    await createInAppNotification({
      userId,
      title: `Meeting request from ${senderEmail}`,
      body: `${senderEmail} wants to meet (re: "${subject}"), but no calendar availability was found. Please check your calendar settings.`,
      type: "info",
      dedupeKey: `schedule-meeting-${email.id}`,
      metadata: {
        messageId: email.id,
        threadId: email.threadId,
        emailAccountId,
      },
    });
    logger.info("SCHEDULE_MEETING: no slots, sent fallback notification");
    return;
  }

  const defaultCalendarTimeZone = await resolveDefaultCalendarTimeZone({
    userId,
    emailAccountId,
  });
  if ("error" in defaultCalendarTimeZone) {
    logger.warn("Unable to resolve default calendar timezone for schedule_meeting", {
      error: defaultCalendarTimeZone.error,
      userId,
      emailAccountId,
    });
    return;
  }
  const displayTimeZone = defaultCalendarTimeZone.timeZone;

  // 2. Build slot descriptions for the draft
  const slotDescriptions = slots.map((slot, i) => {
    const startLabel = formatDateTimeForUser(new Date(slot.start), displayTimeZone);
    const endLabel = formatDateTimeForUser(new Date(slot.end), displayTimeZone);
    return `Option ${i + 1}: ${startLabel} - ${endLabel}`;
  });

  // 3. Create a draft reply proposing the times
  const draftContent = [
    `Hi ${senderEmail},`,
    "",
    `Thanks for reaching out! I have a few times available for us to meet:`,
    "",
    ...slotDescriptions,
    "",
    "Let me know which works best for you, and I'll send over a calendar invite.",
    "",
    "Best regards",
  ].join("\n");

  let draftId: string | undefined;
  try {
    const draftResult = await client.createDraft({
      to: senderEmail,
      subject: `Re: ${subject}`,
      messageHtml: draftContent.replace(/\n/g, "<br>"),
      replyToMessageId: email.headers["message-id"],
    });
    draftId = draftResult.id;
  } catch (error) {
    logger.warn("SCHEDULE_MEETING: failed to create draft", { error });
  }

  // 4. Serializable slot options for the approval payload
  const serializedOptions = slots.map((slot) => ({
    start: slot.start.toISOString(),
    end: slot.end.toISOString(),
    timeZone: displayTimeZone,
  }));

  // 5. Create approval request
  const approvalService = new ApprovalService(prisma);
  const approvalRequest = await approvalService.createRequest({
    userId,
    provider: "in_app",
    externalContext: {},
    sourceType: "email_rule",
    sourceId: email.id,
    requestPayload: {
      actionType: "schedule_proposal",
      description: `Meeting with ${senderEmail} re: ${subject}`,
      tool: "create",
      args: {
        resource: "calendar",
        data: {
          title: `Meeting with ${senderEmail}`,
          autoSchedule: false,
        },
      },
      originalIntent: "event" as const,
      options: serializedOptions,
      draftId,
      draftContent,
      senderEmail,
      messageId: email.id,
      threadId: email.threadId,
      emailAccountId,
    },
    idempotencyKey: `schedule-meeting-${email.id}`,
    expiresInSeconds: expirySeconds,
  });

  // 6. Create rich notification
  await createInAppNotification({
    userId,
    title: `Meeting request from ${senderEmail}`,
    body: `${senderEmail} wants to meet about "${subject}". ${slots.length} time slots available. Draft reply ready for review.`,
    type: "approval",
    dedupeKey: `schedule-meeting-${email.id}`,
    metadata: {
      messageId: email.id,
      threadId: email.threadId,
      emailAccountId,
      approvalRequestId: approvalRequest.id,
      senderEmail,
      subject,
      slots: serializedOptions,
      draftId,
      draftPreview: draftContent.substring(0, 300),
    },
  });

  logger.info("SCHEDULE_MEETING: approval + notification created", {
    approvalRequestId: approvalRequest.id,
    slotCount: slots.length,
    hasDraft: Boolean(draftId),
  });
};

async function lazyUpdateActionLabelId({
  labelName,
  labelId,
  emailAccountId,
  logger,
}: {
  labelName: string;
  labelId: string;
  emailAccountId: string;
  logger: Logger;
}) {
  try {
    const result = await prisma.action.updateMany({
      where: {
        label: labelName,
        labelId: null,
        rule: { emailAccountId },
      },
      data: { labelId },
    });

    if (result.count > 0) {
      logger.info("Lazy-updated Action labelId", {
        labelId,
        updatedCount: result.count,
      });
    }
  } catch (error) {
    logger.warn("Failed to lazy-update Action labelId", {
      labelId,
      error,
    });
  }
}

async function lazyUpdateActionFolderId({
  folderName,
  folderId,
  emailAccountId,
  logger,
}: {
  folderName: string;
  folderId: string;
  emailAccountId: string;
  logger: Logger;
}) {
  try {
    const result = await prisma.action.updateMany({
      where: {
        folderName,
        folderId: null,
        rule: { emailAccountId },
      },
      data: { folderId },
    });

    if (result.count > 0) {
      logger.info("Lazy-updated Action folderId", {
        folderId,
        updatedCount: result.count,
      });
    }
  } catch (error) {
    logger.warn("Failed to lazy-update Action folderId", {
      folderId,
      error,
    });
  }
}
