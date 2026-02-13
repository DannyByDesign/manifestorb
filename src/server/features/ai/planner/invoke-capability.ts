import type { SkillCapabilities } from "@/server/features/ai/capabilities";
import type { ToolResult } from "@/server/features/ai/tools/types";
import type { CapabilityName } from "@/server/features/ai/skills/contracts/skill-contract";

function asStringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string")
    : [];
}

function asString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : undefined;
}

function asBoolean(value: unknown): boolean | undefined {
  return typeof value === "boolean" ? value : undefined;
}

function asObject(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

export async function invokeCapability(params: {
  capability: CapabilityName;
  args: Record<string, unknown>;
  capabilities: SkillCapabilities;
}): Promise<ToolResult> {
  const { capability, args, capabilities } = params;
  switch (capability) {
    case "email.searchThreads":
      return capabilities.email.searchThreads(asObject(args));
    case "email.searchThreadsAdvanced":
      return capabilities.email.searchThreadsAdvanced(asObject(args));
    case "email.searchSent":
      return capabilities.email.searchSent(asObject(args));
    case "email.searchInbox":
      return capabilities.email.searchInbox(asObject(args));
    case "email.getThreadMessages":
      return capabilities.email.getThreadMessages(asString(args.threadId) ?? "");
    case "email.getMessagesBatch":
      return capabilities.email.getMessagesBatch(asStringArray(args.ids));
    case "email.getLatestMessage":
      return capabilities.email.getLatestMessage(asString(args.threadId) ?? "");
    case "email.batchArchive":
      return capabilities.email.batchArchive(asStringArray(args.ids));
    case "email.batchTrash":
      return capabilities.email.batchTrash(asStringArray(args.ids));
    case "email.markReadUnread":
      return capabilities.email.markReadUnread(
        asStringArray(args.ids),
        asBoolean(args.read) ?? true,
      );
    case "email.applyLabels":
      return capabilities.email.applyLabels(
        asStringArray(args.ids),
        asStringArray(args.labelIds),
      );
    case "email.removeLabels":
      return capabilities.email.removeLabels(
        asStringArray(args.ids),
        asStringArray(args.labelIds),
      );
    case "email.moveThread":
      return capabilities.email.moveThread(
        asStringArray(args.ids),
        asString(args.folderName) ?? "",
      );
    case "email.markSpam":
      return capabilities.email.markSpam(asStringArray(args.ids));
    case "email.unsubscribeSender":
      return capabilities.email.unsubscribeSender({
        ids: asStringArray(args.ids),
        filter: args.filter ? asObject(args.filter) : undefined,
      });
    case "email.blockSender":
      return capabilities.email.blockSender(asStringArray(args.ids));
    case "email.bulkSenderArchive":
      return capabilities.email.bulkSenderArchive(asObject(args.filter));
    case "email.bulkSenderTrash":
      return capabilities.email.bulkSenderTrash(asObject(args.filter));
    case "email.bulkSenderLabel":
      return capabilities.email.bulkSenderLabel({
        filter: asObject(args.filter),
        labelId: asString(args.labelId) ?? "",
      });
    case "email.snoozeThread":
      return capabilities.email.snoozeThread(
        asStringArray(args.ids),
        asString(args.snoozeUntil) ?? "",
      );
    case "email.listFilters":
      return capabilities.email.listFilters();
    case "email.createFilter":
      return capabilities.email.createFilter({
        from: asString(args.from) ?? "",
        addLabelIds: asStringArray(args.addLabelIds),
        removeLabelIds: asStringArray(args.removeLabelIds),
        autoArchiveLabelName: asString(args.autoArchiveLabelName),
      });
    case "email.deleteFilter":
      return capabilities.email.deleteFilter(asString(args.id) ?? "");
    case "email.listDrafts":
      return capabilities.email.listDrafts(
        typeof args.limit === "number" ? args.limit : undefined,
      );
    case "email.getDraft":
      return capabilities.email.getDraft(asString(args.draftId) ?? "");
    case "email.createDraft":
      return capabilities.email.createDraft({
        to: asStringArray(args.to),
        subject: asString(args.subject),
        body: asString(args.body) ?? "",
        type:
          args.type === "new" || args.type === "reply" || args.type === "forward"
            ? args.type
            : undefined,
        parentId: asString(args.parentId),
        sendOnApproval: asBoolean(args.sendOnApproval),
      });
    case "email.updateDraft":
      return capabilities.email.updateDraft({
        draftId: asString(args.draftId) ?? "",
        subject: asString(args.subject),
        body: asString(args.body),
      });
    case "email.deleteDraft":
      return capabilities.email.deleteDraft(asString(args.draftId) ?? "");
    case "email.sendDraft":
      return capabilities.email.sendDraft(asString(args.draftId) ?? "");
    case "email.sendNow":
      return capabilities.email.sendNow({
        draftId: asString(args.draftId),
        to: asStringArray(args.to),
        subject: asString(args.subject),
        body: asString(args.body),
      });
    case "email.reply":
      return capabilities.email.reply({
        parentId: asString(args.parentId) ?? "",
        body: asString(args.body) ?? "",
        subject: asString(args.subject),
      });
    case "email.forward":
      return capabilities.email.forward({
        parentId: asString(args.parentId) ?? "",
        to: asStringArray(args.to),
        body: asString(args.body),
        subject: asString(args.subject),
      });
    case "email.scheduleSend":
      return capabilities.email.scheduleSend(
        asString(args.draftId) ?? "",
        asString(args.sendAt) ?? "",
      );
    case "calendar.findAvailability":
      return capabilities.calendar.findAvailability(asObject(args));
    case "calendar.listEvents":
      return capabilities.calendar.listEvents(asObject(args));
    case "calendar.searchEventsByAttendee":
      return capabilities.calendar.searchEventsByAttendee(asObject(args));
    case "calendar.getEvent":
      return capabilities.calendar.getEvent({
        eventId: asString(args.eventId) ?? "",
        calendarId: asString(args.calendarId),
      });
    case "calendar.createEvent":
      return capabilities.calendar.createEvent(asObject(args));
    case "calendar.updateEvent":
      return capabilities.calendar.updateEvent({
        eventId: asString(args.eventId) ?? "",
        calendarId: asString(args.calendarId),
        changes: asObject(args.changes),
      });
    case "calendar.deleteEvent":
      return capabilities.calendar.deleteEvent({
        eventId: asString(args.eventId) ?? "",
        calendarId: asString(args.calendarId),
        mode: args.mode === "single" || args.mode === "series" ? args.mode : undefined,
      });
    case "calendar.manageAttendees":
      return capabilities.calendar.manageAttendees({
        eventId: asString(args.eventId) ?? "",
        calendarId: asString(args.calendarId),
        attendees: asStringArray(args.attendees),
        mode: args.mode === "single" || args.mode === "series" ? args.mode : undefined,
      });
    case "calendar.updateRecurringMode":
      return capabilities.calendar.updateRecurringMode({
        eventId: asString(args.eventId) ?? "",
        calendarId: asString(args.calendarId),
        mode: args.mode === "single" || args.mode === "series" ? args.mode : "single",
        changes: args.changes ? asObject(args.changes) : undefined,
      });
    case "calendar.rescheduleEvent":
      return capabilities.calendar.rescheduleEvent(
        asStringArray(args.eventIds),
        asObject(args.changes),
      );
    case "calendar.setWorkingHours":
      return capabilities.calendar.setWorkingHours(asObject(args));
    case "calendar.setWorkingLocation":
      return capabilities.calendar.setWorkingLocation(asObject(args));
    case "calendar.setOutOfOffice":
      return capabilities.calendar.setOutOfOffice(asObject(args));
    case "calendar.createFocusBlock":
      return capabilities.calendar.createFocusBlock(asObject(args));
    case "calendar.createBookingSchedule":
      return capabilities.calendar.createBookingSchedule(asObject(args));
    case "planner.composeDayPlan":
      return capabilities.planner.composeDayPlan({
        topEmailItems: Array.isArray(args.topEmailItems) ? args.topEmailItems : [],
        calendarItems: Array.isArray(args.calendarItems) ? args.calendarItems : [],
        focusSuggestions: asStringArray(args.focusSuggestions),
      });
    case "planner.compileMultiActionPlan":
      return capabilities.planner.compileMultiActionPlan({
        actions: Array.isArray(args.actions)
          ? args.actions.filter(
              (item): item is Record<string, unknown> =>
                Boolean(item) && typeof item === "object" && !Array.isArray(item),
            )
          : [],
        constraints: args.constraints ? asObject(args.constraints) : undefined,
      });
    default:
      return {
        success: false,
        error: `unsupported_capability:${capability}`,
        message: `Capability ${capability} is not supported by planner executor.`,
      };
  }
}
