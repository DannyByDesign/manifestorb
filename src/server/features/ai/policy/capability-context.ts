import type { CapabilityName } from "@/server/features/ai/contracts/capability-contract";

function asString(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function asStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter((item): item is string => typeof item === "string")
    .map((item) => item.trim())
    .filter((item) => item.length > 0);
}

function collectIds(args: Record<string, unknown>): string[] {
  const ids = new Set<string>();
  const addMany = (value: unknown) => {
    for (const id of asStringArray(value)) ids.add(id);
  };
  const addOne = (value: unknown) => {
    const parsed = asString(value);
    if (parsed) ids.add(parsed);
  };

  addMany(args.ids);
  addMany(args.thread_ids);
  addMany(args.threadIds);
  addMany(args.event_ids);
  addMany(args.eventIds);

  addOne(args.thread_id);
  addOne(args.threadId);
  addOne(args.event_id);
  addOne(args.eventId);
  addOne(args.message_id);
  addOne(args.messageId);
  addOne(args.rule_id);
  addOne(args.ruleId);
  addOne(args.id);

  return [...ids];
}

function collectRecipientEmails(args: Record<string, unknown>): string[] {
  const recipients = new Set<string>();
  const addMany = (value: unknown) => {
    for (const email of asStringArray(value)) recipients.add(email);
  };
  const addOne = (value: unknown) => {
    const parsed = asString(value);
    if (parsed) recipients.add(parsed);
  };

  addMany(args.to);
  addMany(args.recipient);
  addMany(args.cc);
  addMany(args.bcc);
  addOne(args.attendee_email);
  addOne(args.attendeeEmail);

  const participants = args.participants;
  if (participants && typeof participants === "object") {
    addMany((participants as Record<string, unknown>).emails);
  }

  return [...recipients];
}

export function mapCapabilityToPolicyContext(params: {
  capability: CapabilityName;
  args: Record<string, unknown>;
}): {
  toolName: string;
  args: Record<string, unknown>;
} {
  const { capability, args } = params;
  const ids = collectIds(args);
  const to = collectRecipientEmails(args);

  const operationByCapability: Partial<Record<CapabilityName, string>> = {
    "email.batchTrash": "delete_email",
    "calendar.deleteEvent": "delete_calendar_event",
    "email.sendNow": "send_email",
    "email.sendDraft": "send_email",
    "email.reply": "send_email",
    "email.forward": "send_email",
    "calendar.createEvent": "create_calendar_event",
    "email.createDraft": "create_email_draft",
    "email.unsubscribeSender": "unsubscribe_sender",
    "email.bulkSenderTrash": "bulk_trash_senders",
    "email.bulkSenderArchive": "bulk_archive_senders",
    "email.bulkSenderLabel": "bulk_label_senders",
    "email.batchArchive": "archive_email",
    "calendar.rescheduleEvent": "update_calendar_event",
    "policy.listRules": "list_rules",
    "policy.compileRule": "compile_rule",
    "policy.createRule": "create_rule",
    "policy.updateRule": "update_rule",
    "policy.disableRule": "disable_rule",
    "policy.deleteRule": "delete_rule",
  };

  const operation = operationByCapability[capability];

  if (
    capability.startsWith("email.delete") ||
    capability === "email.batchTrash" ||
    capability === "calendar.deleteEvent" ||
    capability === "policy.deleteRule"
  ) {
    return {
      toolName: "delete",
      args: {
        resource:
          capability.startsWith("calendar")
            ? "calendar"
            : capability.startsWith("policy")
              ? "rule"
              : "email",
        ...(ids.length > 0 ? { ids } : {}),
        ...(operation ? { operation } : {}),
      },
    };
  }

  if (
    capability === "email.sendNow" ||
    capability === "email.sendDraft" ||
    capability === "email.reply" ||
    capability === "email.forward"
  ) {
    return {
      toolName: "send",
      args: {
        resource: "email",
        ...(to.length > 0 ? { to } : {}),
        ...(operation ? { operation } : {}),
      },
    };
  }

  if (
    capability.startsWith("calendar.create") ||
    capability.startsWith("email.create") ||
    capability === "policy.createRule"
  ) {
    return {
      toolName: "create",
      args: {
        resource:
          capability.startsWith("calendar")
            ? "calendar"
            : capability.startsWith("policy")
              ? "rule"
              : "email",
        ...(to.length > 0 ? { to } : {}),
        ...(operation ? { operation } : {}),
      },
    };
  }

  if (
    capability === "policy.listRules" ||
    capability === "policy.compileRule"
  ) {
    return {
      toolName: capability === "policy.listRules" ? "query" : "analyze",
      args: {
        resource: "rule",
        ...(operation ? { operation } : {}),
      },
    };
  }

  if (
    capability === "policy.updateRule" ||
    capability === "policy.disableRule"
  ) {
    return {
      toolName: "modify",
      args: {
        resource: "rule",
        ...(ids.length > 0 ? { ids } : {}),
        ...(operation ? { operation } : {}),
      },
    };
  }

  if (capability.startsWith("calendar.")) {
    return {
      toolName: "modify",
      args: {
        resource: "calendar",
        ...(ids.length > 0 ? { ids } : {}),
        ...(to.length > 0 ? { to } : {}),
        ...(operation ? { operation } : {}),
      },
    };
  }

  if (capability.startsWith("planner.")) {
    return {
      toolName: "analyze",
      args: {
        resource: "report",
      },
    };
  }

  if (capability.startsWith("email.")) {
    return {
      toolName: "modify",
      args: {
        resource: "email",
        ...(ids.length > 0 ? { ids } : {}),
        ...(to.length > 0 ? { to } : {}),
        ...(operation ? { operation } : {}),
      },
    };
  }

  return {
    toolName: "query",
    args: {
      resource: "email",
      ...(operation ? { operation } : {}),
    },
  };
}
