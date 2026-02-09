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
import { ApprovalService } from "@/features/approvals/service";
import { createInAppNotification } from "@/features/notifications/create";
import { applyTaskPreferencePayloadsForUser } from "@/features/preferences/service";

const MODULE = "ai-actions";

type ActionFunction<T extends Partial<Omit<ActionItem, "type">>> = (options: {
  client: EmailProvider;
  email: EmailForAction;
  args: T;
  userEmail: string;
  userId: string;
  emailAccountId: string;
  executedRule: ExecutedRule;
  logger: Logger;
}) => Promise<any>;

export const runActionFunction = async (options: {
  client: EmailProvider;
  email: EmailForAction;
  action: ActionItem;
  userEmail: string;
  userId: string;
  emailAccountId: string;
  executedRule: ExecutedRule;
  logger: Logger;
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
  switch (type) {
    case ActionType.ARCHIVE:
      return archive(opts);
    case ActionType.LABEL:
      return label(opts);
    case ActionType.DRAFT_EMAIL:
      return draft(opts);
    case ActionType.REPLY:
      ensureEmailSendingEnabled();
      return reply(opts);
    case ActionType.SEND_EMAIL:
      ensureEmailSendingEnabled();
      return send_email(opts);
    case ActionType.FORWARD:
      ensureEmailSendingEnabled();
      return forward(opts);
    case ActionType.MARK_SPAM:
      return mark_spam(opts);
    case ActionType.CALL_WEBHOOK:
      return call_webhook(opts);
    case ActionType.MARK_READ:
      return mark_read(opts);
    case ActionType.DIGEST:
      return digest(opts);
    case ActionType.MOVE_FOLDER:
      return move_folder(opts);
    case ActionType.NOTIFY_SENDER:
      return notify_sender(opts);
    case ActionType.NOTIFY_USER:
      return notify_user(opts);
    case ActionType.SET_TASK_PREFERENCES:
      return set_task_preferences(opts);
    case ActionType.CREATE_TASK:
      return create_task(opts);
    case ActionType.CREATE_CALENDAR_EVENT:
      return create_calendar_event(opts);
    case ActionType.SCHEDULE_MEETING:
      return schedule_meeting(opts);
    default: {
      await import("./actions/register-defaults");
      const { getAction } = await import("./actions/registry");
      const registered = getAction(String(type));
      if (registered) return registered.execute(opts);
      throw new Error(`Unknown action: ${action}`);
    }
  }
};

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

const set_task_preferences: ActionFunction<{ payload?: any }> = async ({
  userId,
  args,
  logger,
}) => {
  const payload = args.payload;
  if (!payload || typeof payload !== "object") {
    logger.warn("Missing payload for set_task_preferences action");
    return;
  }

  await applyTaskPreferencePayloadsForUser({
    userId,
    payloads: [payload],
    logger,
  });
};

const create_task: ActionFunction<{ payload?: any }> = async ({
  userId,
  emailAccountId,
  args,
  logger,
}) => {
  const payload = args.payload;
  if (!payload || typeof payload !== "object") {
    logger.warn("Missing payload for create_task action");
    return;
  }

  const task = await prisma.task.create({
    data: {
      userId,
      title: payload.title,
      description: payload.description ?? null,
      durationMinutes: payload.durationMinutes ?? null,
      status: payload.status ?? "PENDING",
      priority: payload.priority ?? "NONE",
      energyLevel: payload.energyLevel ?? null,
      preferredTime: payload.preferredTime ?? null,
      dueDate: payload.dueDate ? new Date(payload.dueDate) : null,
      startDate: payload.startDate ? new Date(payload.startDate) : null,
      isAutoScheduled: payload.isAutoScheduled ?? true,
      scheduleLocked: payload.scheduleLocked ?? false,
      reschedulePolicy: payload.reschedulePolicy ?? "FLEXIBLE",
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

const create_calendar_event: ActionFunction<{ payload?: any }> = async ({
  userId,
  emailAccountId,
  args,
  logger,
}) => {
  const payload = args.payload;
  if (!payload || typeof payload !== "object") {
    logger.warn("Missing payload for create_calendar_event action");
    return;
  }

  if (!payload.start || !payload.end) {
    logger.warn("Calendar event payload missing start/end", {
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
    requestedTimeZone:
      typeof payload.timeZone === "string" ? payload.timeZone : undefined,
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
    String(payload.start),
    effectiveTimeZone.timeZone,
    "start",
  );
  const parsedEnd = parseDateBoundInTimeZone(
    String(payload.end),
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
    calendarId: payload.calendarId,
    input: {
      title: payload.title,
      description: payload.description,
      start: parsedStart,
      end: parsedEnd,
      allDay: payload.allDay,
      isRecurring: payload.isRecurring,
      recurrenceRule: payload.recurrenceRule,
      timeZone: effectiveTimeZone.timeZone,
      location: payload.location,
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
