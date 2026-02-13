import type { CapabilityName } from "@/server/features/ai/skills/contracts/skill-contract";

function toStringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string")
    : [];
}

export function mapPlannerCapabilityToApprovalContext(params: {
  capability: CapabilityName;
  args: Record<string, unknown>;
}): {
  toolName: string;
  args: Record<string, unknown>;
} {
  const { capability, args } = params;
  const ids = toStringArray(args.ids);
  const eventIds = toStringArray(args.eventIds);
  const to = toStringArray(args.to);

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
  };
  const operation = operationByCapability[capability];

  if (
    capability.startsWith("email.delete") ||
    capability === "email.batchTrash" ||
    capability === "calendar.deleteEvent"
  ) {
    return {
      toolName: "delete",
      args: {
        resource: capability.startsWith("calendar") ? "calendar" : "email",
        ids: ids.length > 0 ? ids : eventIds,
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
        to,
        ...(operation ? { operation } : {}),
      },
    };
  }

  if (
    capability.startsWith("calendar.create") ||
    capability.startsWith("email.create")
  ) {
    return {
      toolName: "create",
      args: {
        resource: capability.startsWith("calendar") ? "calendar" : "email",
        to,
        ...(operation ? { operation } : {}),
      },
    };
  }

  if (capability.startsWith("calendar.") && capability !== "calendar.findAvailability" && capability !== "calendar.listEvents" && capability !== "calendar.searchEventsByAttendee" && capability !== "calendar.getEvent") {
    return {
      toolName: "modify",
      args: {
        resource: "calendar",
        ids: eventIds.length > 0 ? eventIds : ids,
        to,
        ...(operation ? { operation } : {}),
      },
    };
  }

  if (
    capability.startsWith("email.") &&
    !capability.startsWith("email.search") &&
    capability !== "email.getThreadMessages" &&
    capability !== "email.getMessagesBatch" &&
    capability !== "email.getLatestMessage" &&
    capability !== "email.listFilters" &&
    capability !== "email.listDrafts" &&
    capability !== "email.getDraft"
  ) {
    return {
      toolName: "modify",
      args: {
        resource: "email",
        ids,
        to,
        ...(operation ? { operation } : {}),
      },
    };
  }

  if (capability.startsWith("planner.")) {
    return { toolName: "analyze", args: { resource: "report" } };
  }

  if (capability === "policy.listRules") {
    return {
      toolName: "query",
      args: {
        resource: "rule",
        operation: "list_rules",
      },
    };
  }

  if (capability === "policy.compileRule") {
    return {
      toolName: "analyze",
      args: {
        resource: "rule",
        operation: "compile_rule",
      },
    };
  }

  if (capability === "policy.createRule") {
    return {
      toolName: "create",
      args: {
        resource: "rule",
        operation: "create_rule",
      },
    };
  }

  if (capability === "policy.updateRule") {
    return {
      toolName: "modify",
      args: {
        resource: "rule",
        operation: "update_rule",
      },
    };
  }

  if (capability === "policy.disableRule") {
    return {
      toolName: "modify",
      args: {
        resource: "rule",
        operation: "disable_rule",
      },
    };
  }

  if (capability === "policy.deleteRule") {
    return {
      toolName: "delete",
      args: {
        resource: "rule",
        operation: "delete_rule",
      },
    };
  }

  return {
    toolName: "query",
    args: {
      resource: capability.startsWith("calendar") ? "calendar" : "email",
    },
  };
}
