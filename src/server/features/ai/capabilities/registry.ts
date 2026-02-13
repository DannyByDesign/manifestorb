import { z } from "zod";
import {
  capabilityNameSchema,
  type CapabilityName,
} from "@/server/features/ai/skills/contracts/skill-contract";

export type CapabilityRiskLevel = "safe" | "caution" | "dangerous";
export type CapabilityIntentFamily =
  | "inbox_read"
  | "inbox_mutate"
  | "inbox_compose"
  | "inbox_controls"
  | "calendar_read"
  | "calendar_mutate"
  | "calendar_policy"
  | "cross_surface_planning";

export interface CapabilityEffectDescriptor {
  resource: "email" | "calendar" | "planner" | "preferences" | "rule";
  mutates: boolean;
}

export interface CapabilityDefinition {
  id: CapabilityName;
  description: string;
  inputSchema: z.ZodTypeAny;
  outputSchema: z.ZodTypeAny;
  readOnly: boolean;
  riskLevel: CapabilityRiskLevel;
  approvalOperation: string;
  intentFamilies: CapabilityIntentFamily[];
  tags: string[];
  effects: CapabilityEffectDescriptor[];
}

const unknownObject = z.record(z.string(), z.unknown());
const idListSchema = z.object({ ids: z.array(z.string().min(1)).min(1) }).strict();
const threadIdSchema = z.object({ threadId: z.string().min(1) }).strict();
const draftIdSchema = z.object({ draftId: z.string().min(1) }).strict();
const eventIdSchema = z.object({
  eventId: z.string().min(1),
  calendarId: z.string().min(1).optional(),
}).strict();

function buildCapabilityDefinitions(): CapabilityDefinition[] {
  return [
    {
      id: "email.searchThreads",
      description: "Search inbox threads using query/filter constraints.",
      inputSchema: unknownObject,
      outputSchema: z.unknown(),
      readOnly: true,
      riskLevel: "safe",
      approvalOperation: "query",
      intentFamilies: ["inbox_read", "cross_surface_planning"],
      tags: ["email", "search", "threads", "query"],
      effects: [{ resource: "email", mutates: false }],
    },
    {
      id: "email.searchThreadsAdvanced",
      description: "Advanced thread search using rich filter constraints.",
      inputSchema: unknownObject,
      outputSchema: z.unknown(),
      readOnly: true,
      riskLevel: "safe",
      approvalOperation: "query",
      intentFamilies: ["inbox_read", "cross_surface_planning"],
      tags: ["email", "search", "advanced"],
      effects: [{ resource: "email", mutates: false }],
    },
    {
      id: "email.searchSent",
      description: "Search sent mailbox messages and threads.",
      inputSchema: unknownObject,
      outputSchema: z.unknown(),
      readOnly: true,
      riskLevel: "safe",
      approvalOperation: "query",
      intentFamilies: ["inbox_read"],
      tags: ["email", "search", "sent"],
      effects: [{ resource: "email", mutates: false }],
    },
    {
      id: "email.searchInbox",
      description: "Search inbox-focused messages and threads.",
      inputSchema: unknownObject,
      outputSchema: z.unknown(),
      readOnly: true,
      riskLevel: "safe",
      approvalOperation: "query",
      intentFamilies: ["inbox_read"],
      tags: ["email", "search", "inbox"],
      effects: [{ resource: "email", mutates: false }],
    },
    {
      id: "email.getThreadMessages",
      description: "Load full message history for a thread.",
      inputSchema: threadIdSchema,
      outputSchema: z.unknown(),
      readOnly: true,
      riskLevel: "safe",
      approvalOperation: "get",
      intentFamilies: ["inbox_read", "inbox_compose"],
      tags: ["email", "thread", "messages"],
      effects: [{ resource: "email", mutates: false }],
    },
    {
      id: "email.getMessagesBatch",
      description: "Load a batch of message payloads by id.",
      inputSchema: idListSchema,
      outputSchema: z.unknown(),
      readOnly: true,
      riskLevel: "safe",
      approvalOperation: "get",
      intentFamilies: ["inbox_read"],
      tags: ["email", "batch", "messages"],
      effects: [{ resource: "email", mutates: false }],
    },
    {
      id: "email.getLatestMessage",
      description: "Fetch latest message from a thread.",
      inputSchema: threadIdSchema,
      outputSchema: z.unknown(),
      readOnly: true,
      riskLevel: "safe",
      approvalOperation: "get",
      intentFamilies: ["inbox_read", "inbox_compose"],
      tags: ["email", "latest", "thread"],
      effects: [{ resource: "email", mutates: false }],
    },
    {
      id: "email.batchArchive",
      description: "Archive target messages/threads in bulk.",
      inputSchema: idListSchema,
      outputSchema: z.unknown(),
      readOnly: false,
      riskLevel: "caution",
      approvalOperation: "archive_email",
      intentFamilies: ["inbox_mutate", "inbox_controls"],
      tags: ["email", "archive", "bulk"],
      effects: [{ resource: "email", mutates: true }],
    },
    {
      id: "email.batchTrash",
      description: "Move target messages/threads to trash.",
      inputSchema: idListSchema,
      outputSchema: z.unknown(),
      readOnly: false,
      riskLevel: "dangerous",
      approvalOperation: "delete_email",
      intentFamilies: ["inbox_mutate", "inbox_controls"],
      tags: ["email", "trash", "delete", "bulk"],
      effects: [{ resource: "email", mutates: true }],
    },
    {
      id: "email.markReadUnread",
      description: "Change read state for messages/threads.",
      inputSchema: z.object({ ids: z.array(z.string().min(1)).min(1), read: z.boolean() }).strict(),
      outputSchema: z.unknown(),
      readOnly: false,
      riskLevel: "safe",
      approvalOperation: "update_email",
      intentFamilies: ["inbox_mutate"],
      tags: ["email", "read", "unread"],
      effects: [{ resource: "email", mutates: true }],
    },
    {
      id: "email.applyLabels",
      description: "Apply labels to target messages/threads.",
      inputSchema: z.object({
        ids: z.array(z.string().min(1)).min(1),
        labelIds: z.array(z.string().min(1)).min(1),
      }).strict(),
      outputSchema: z.unknown(),
      readOnly: false,
      riskLevel: "safe",
      approvalOperation: "update_email",
      intentFamilies: ["inbox_mutate", "inbox_controls"],
      tags: ["email", "labels", "apply"],
      effects: [{ resource: "email", mutates: true }],
    },
    {
      id: "email.removeLabels",
      description: "Remove labels from target messages/threads.",
      inputSchema: z.object({
        ids: z.array(z.string().min(1)).min(1),
        labelIds: z.array(z.string().min(1)).min(1),
      }).strict(),
      outputSchema: z.unknown(),
      readOnly: false,
      riskLevel: "safe",
      approvalOperation: "update_email",
      intentFamilies: ["inbox_mutate", "inbox_controls"],
      tags: ["email", "labels", "remove"],
      effects: [{ resource: "email", mutates: true }],
    },
    {
      id: "email.moveThread",
      description: "Move threads into a destination folder.",
      inputSchema: z.object({
        ids: z.array(z.string().min(1)).min(1),
        folderName: z.string().min(1),
      }).strict(),
      outputSchema: z.unknown(),
      readOnly: false,
      riskLevel: "caution",
      approvalOperation: "update_email",
      intentFamilies: ["inbox_mutate", "inbox_controls"],
      tags: ["email", "move", "folder"],
      effects: [{ resource: "email", mutates: true }],
    },
    {
      id: "email.markSpam",
      description: "Mark target threads as spam/junk.",
      inputSchema: idListSchema,
      outputSchema: z.unknown(),
      readOnly: false,
      riskLevel: "dangerous",
      approvalOperation: "trash_email",
      intentFamilies: ["inbox_mutate", "inbox_controls"],
      tags: ["email", "spam", "junk"],
      effects: [{ resource: "email", mutates: true }],
    },
    {
      id: "email.unsubscribeSender",
      description: "Unsubscribe or block sender via ids or sender filter.",
      inputSchema: z.object({
        ids: z.array(z.string().min(1)).optional(),
        filter: unknownObject.optional(),
      }).strict(),
      outputSchema: z.unknown(),
      readOnly: false,
      riskLevel: "caution",
      approvalOperation: "unsubscribe_sender",
      intentFamilies: ["inbox_controls", "inbox_mutate"],
      tags: ["email", "unsubscribe", "sender"],
      effects: [{ resource: "email", mutates: true }],
    },
    {
      id: "email.blockSender",
      description: "Block sender(s) from target messages.",
      inputSchema: idListSchema,
      outputSchema: z.unknown(),
      readOnly: false,
      riskLevel: "dangerous",
      approvalOperation: "update_email",
      intentFamilies: ["inbox_controls", "inbox_mutate"],
      tags: ["email", "block", "sender"],
      effects: [{ resource: "email", mutates: true }],
    },
    {
      id: "email.bulkSenderArchive",
      description: "Archive sender-matched threads in bulk.",
      inputSchema: z.object({ filter: unknownObject }).strict(),
      outputSchema: z.unknown(),
      readOnly: false,
      riskLevel: "caution",
      approvalOperation: "bulk_archive_senders",
      intentFamilies: ["inbox_controls", "inbox_mutate"],
      tags: ["email", "bulk", "sender", "archive"],
      effects: [{ resource: "email", mutates: true }],
    },
    {
      id: "email.bulkSenderTrash",
      description: "Trash sender-matched threads in bulk.",
      inputSchema: z.object({ filter: unknownObject }).strict(),
      outputSchema: z.unknown(),
      readOnly: false,
      riskLevel: "dangerous",
      approvalOperation: "bulk_trash_senders",
      intentFamilies: ["inbox_controls", "inbox_mutate"],
      tags: ["email", "bulk", "sender", "trash"],
      effects: [{ resource: "email", mutates: true }],
    },
    {
      id: "email.bulkSenderLabel",
      description: "Apply a label to sender-matched threads in bulk.",
      inputSchema: z.object({
        filter: unknownObject,
        labelId: z.string().min(1),
      }).strict(),
      outputSchema: z.unknown(),
      readOnly: false,
      riskLevel: "caution",
      approvalOperation: "bulk_label_senders",
      intentFamilies: ["inbox_controls", "inbox_mutate"],
      tags: ["email", "bulk", "sender", "label"],
      effects: [{ resource: "email", mutates: true }],
    },
    {
      id: "email.snoozeThread",
      description: "Snooze target threads until a specific timestamp.",
      inputSchema: z.object({
        ids: z.array(z.string().min(1)).min(1),
        snoozeUntil: z.string().min(1),
      }).strict(),
      outputSchema: z.unknown(),
      readOnly: false,
      riskLevel: "safe",
      approvalOperation: "update_email",
      intentFamilies: ["inbox_mutate"],
      tags: ["email", "snooze", "defer"],
      effects: [{ resource: "email", mutates: true }],
    },
    {
      id: "email.listFilters",
      description: "List current email filters.",
      inputSchema: z.object({}).strict(),
      outputSchema: z.unknown(),
      readOnly: true,
      riskLevel: "safe",
      approvalOperation: "get",
      intentFamilies: ["inbox_controls", "inbox_read"],
      tags: ["email", "filters", "list"],
      effects: [{ resource: "email", mutates: false }],
    },
    {
      id: "email.createFilter",
      description: "Create an inbox filter/rule.",
      inputSchema: z.object({
        from: z.string().min(1),
        addLabelIds: z.array(z.string().min(1)).optional(),
        removeLabelIds: z.array(z.string().min(1)).optional(),
        autoArchiveLabelName: z.string().min(1).optional(),
      }).strict(),
      outputSchema: z.unknown(),
      readOnly: false,
      riskLevel: "caution",
      approvalOperation: "update_automation",
      intentFamilies: ["inbox_controls"],
      tags: ["email", "filters", "create"],
      effects: [{ resource: "email", mutates: true }],
    },
    {
      id: "email.deleteFilter",
      description: "Delete an inbox filter/rule.",
      inputSchema: z.object({ id: z.string().min(1) }).strict(),
      outputSchema: z.unknown(),
      readOnly: false,
      riskLevel: "dangerous",
      approvalOperation: "delete_automation",
      intentFamilies: ["inbox_controls"],
      tags: ["email", "filters", "delete"],
      effects: [{ resource: "email", mutates: true }],
    },
    {
      id: "email.listDrafts",
      description: "List current email drafts.",
      inputSchema: z.object({ limit: z.number().int().positive().optional() }).strict(),
      outputSchema: z.unknown(),
      readOnly: true,
      riskLevel: "safe",
      approvalOperation: "get",
      intentFamilies: ["inbox_compose", "inbox_read"],
      tags: ["email", "drafts", "list"],
      effects: [{ resource: "email", mutates: false }],
    },
    {
      id: "email.getDraft",
      description: "Load one draft by id.",
      inputSchema: draftIdSchema,
      outputSchema: z.unknown(),
      readOnly: true,
      riskLevel: "safe",
      approvalOperation: "get",
      intentFamilies: ["inbox_compose", "inbox_read"],
      tags: ["email", "drafts", "get"],
      effects: [{ resource: "email", mutates: false }],
    },
    {
      id: "email.createDraft",
      description: "Create a new draft or reply draft.",
      inputSchema: z.object({
        to: z.array(z.string().email()).optional(),
        subject: z.string().optional(),
        body: z.string().min(1),
        type: z.enum(["new", "reply", "forward"]).optional(),
        parentId: z.string().optional(),
        sendOnApproval: z.boolean().optional(),
      }).strict(),
      outputSchema: z.unknown(),
      readOnly: false,
      riskLevel: "safe",
      approvalOperation: "create_email_draft",
      intentFamilies: ["inbox_compose"],
      tags: ["email", "draft", "compose"],
      effects: [{ resource: "email", mutates: true }],
    },
    {
      id: "email.updateDraft",
      description: "Update an existing draft body or subject.",
      inputSchema: z.object({
        draftId: z.string().min(1),
        subject: z.string().optional(),
        body: z.string().optional(),
      }).strict(),
      outputSchema: z.unknown(),
      readOnly: false,
      riskLevel: "safe",
      approvalOperation: "update_email",
      intentFamilies: ["inbox_compose"],
      tags: ["email", "draft", "update"],
      effects: [{ resource: "email", mutates: true }],
    },
    {
      id: "email.deleteDraft",
      description: "Delete an existing draft.",
      inputSchema: draftIdSchema,
      outputSchema: z.unknown(),
      readOnly: false,
      riskLevel: "dangerous",
      approvalOperation: "delete_email",
      intentFamilies: ["inbox_compose", "inbox_mutate"],
      tags: ["email", "draft", "delete"],
      effects: [{ resource: "email", mutates: true }],
    },
    {
      id: "email.sendDraft",
      description: "Send an existing draft immediately.",
      inputSchema: draftIdSchema,
      outputSchema: z.unknown(),
      readOnly: false,
      riskLevel: "dangerous",
      approvalOperation: "send_email",
      intentFamilies: ["inbox_compose"],
      tags: ["email", "send", "draft"],
      effects: [{ resource: "email", mutates: true }],
    },
    {
      id: "email.sendNow",
      description: "Send an outbound email now.",
      inputSchema: z.object({
        draftId: z.string().optional(),
        to: z.array(z.string().email()).optional(),
        subject: z.string().optional(),
        body: z.string().optional(),
      }).strict(),
      outputSchema: z.unknown(),
      readOnly: false,
      riskLevel: "dangerous",
      approvalOperation: "send_email",
      intentFamilies: ["inbox_compose"],
      tags: ["email", "send", "compose"],
      effects: [{ resource: "email", mutates: true }],
    },
    {
      id: "email.reply",
      description: "Reply to an existing email thread/message.",
      inputSchema: z.object({
        parentId: z.string().min(1),
        body: z.string().min(1),
        subject: z.string().optional(),
      }).strict(),
      outputSchema: z.unknown(),
      readOnly: false,
      riskLevel: "dangerous",
      approvalOperation: "send_email",
      intentFamilies: ["inbox_compose"],
      tags: ["email", "reply", "send"],
      effects: [{ resource: "email", mutates: true }],
    },
    {
      id: "email.forward",
      description: "Forward an email to one or more recipients.",
      inputSchema: z.object({
        parentId: z.string().min(1),
        to: z.array(z.string().email()).min(1),
        body: z.string().optional(),
        subject: z.string().optional(),
      }).strict(),
      outputSchema: z.unknown(),
      readOnly: false,
      riskLevel: "dangerous",
      approvalOperation: "send_email",
      intentFamilies: ["inbox_compose"],
      tags: ["email", "forward", "send"],
      effects: [{ resource: "email", mutates: true }],
    },
    {
      id: "email.scheduleSend",
      description: "Schedule a draft to be sent at a future time.",
      inputSchema: z.object({
        draftId: z.string().min(1),
        sendAt: z.string().min(1),
      }).strict(),
      outputSchema: z.unknown(),
      readOnly: false,
      riskLevel: "caution",
      approvalOperation: "send_email",
      intentFamilies: ["inbox_compose"],
      tags: ["email", "schedule", "send"],
      effects: [{ resource: "email", mutates: true }],
    },
    {
      id: "calendar.findAvailability",
      description: "Find available calendar time slots.",
      inputSchema: unknownObject,
      outputSchema: z.unknown(),
      readOnly: true,
      riskLevel: "safe",
      approvalOperation: "query",
      intentFamilies: ["calendar_read", "calendar_mutate", "cross_surface_planning"],
      tags: ["calendar", "availability", "freebusy"],
      effects: [{ resource: "calendar", mutates: false }],
    },
    {
      id: "calendar.listEvents",
      description: "List calendar events in a date window.",
      inputSchema: unknownObject,
      outputSchema: z.unknown(),
      readOnly: true,
      riskLevel: "safe",
      approvalOperation: "query",
      intentFamilies: ["calendar_read", "cross_surface_planning"],
      tags: ["calendar", "list", "events"],
      effects: [{ resource: "calendar", mutates: false }],
    },
    {
      id: "calendar.searchEventsByAttendee",
      description: "Search events by attendee email and date constraints.",
      inputSchema: unknownObject,
      outputSchema: z.unknown(),
      readOnly: true,
      riskLevel: "safe",
      approvalOperation: "query",
      intentFamilies: ["calendar_read", "calendar_mutate"],
      tags: ["calendar", "search", "attendee"],
      effects: [{ resource: "calendar", mutates: false }],
    },
    {
      id: "calendar.getEvent",
      description: "Load one calendar event by id.",
      inputSchema: eventIdSchema,
      outputSchema: z.unknown(),
      readOnly: true,
      riskLevel: "safe",
      approvalOperation: "get",
      intentFamilies: ["calendar_read", "calendar_mutate"],
      tags: ["calendar", "event", "get"],
      effects: [{ resource: "calendar", mutates: false }],
    },
    {
      id: "calendar.createEvent",
      description: "Create a new calendar event.",
      inputSchema: z.object({
        title: z.string().optional(),
        start: z.string().min(1),
        end: z.string().min(1),
        attendees: z.array(z.string().email()).optional(),
        location: z.string().optional(),
        description: z.string().optional(),
        timeZone: z.string().optional(),
      }).strict(),
      outputSchema: z.unknown(),
      readOnly: false,
      riskLevel: "dangerous",
      approvalOperation: "create_calendar_event",
      intentFamilies: ["calendar_mutate", "cross_surface_planning"],
      tags: ["calendar", "create", "event"],
      effects: [{ resource: "calendar", mutates: true }],
    },
    {
      id: "calendar.updateEvent",
      description: "Update event fields for an existing event.",
      inputSchema: z.object({
        eventId: z.string().min(1),
        calendarId: z.string().optional(),
        changes: unknownObject,
      }).strict(),
      outputSchema: z.unknown(),
      readOnly: false,
      riskLevel: "caution",
      approvalOperation: "update_calendar_event",
      intentFamilies: ["calendar_mutate"],
      tags: ["calendar", "update", "event"],
      effects: [{ resource: "calendar", mutates: true }],
    },
    {
      id: "calendar.deleteEvent",
      description: "Delete/cancel an event.",
      inputSchema: z.object({
        eventId: z.string().min(1),
        calendarId: z.string().optional(),
        mode: z.enum(["single", "series"]).optional(),
      }).strict(),
      outputSchema: z.unknown(),
      readOnly: false,
      riskLevel: "dangerous",
      approvalOperation: "delete_calendar_event",
      intentFamilies: ["calendar_mutate"],
      tags: ["calendar", "delete", "cancel"],
      effects: [{ resource: "calendar", mutates: true }],
    },
    {
      id: "calendar.manageAttendees",
      description: "Replace/update attendees on an event.",
      inputSchema: z.object({
        eventId: z.string().min(1),
        calendarId: z.string().optional(),
        attendees: z.array(z.string().email()).min(1),
        mode: z.enum(["single", "series"]).optional(),
      }).strict(),
      outputSchema: z.unknown(),
      readOnly: false,
      riskLevel: "caution",
      approvalOperation: "update_calendar_event",
      intentFamilies: ["calendar_mutate"],
      tags: ["calendar", "attendees", "participants"],
      effects: [{ resource: "calendar", mutates: true }],
    },
    {
      id: "calendar.updateRecurringMode",
      description: "Update recurring-series behavior for one or all instances.",
      inputSchema: z.object({
        eventId: z.string().min(1),
        calendarId: z.string().optional(),
        mode: z.enum(["single", "series"]),
        changes: unknownObject.optional(),
      }).strict(),
      outputSchema: z.unknown(),
      readOnly: false,
      riskLevel: "caution",
      approvalOperation: "update_calendar_event",
      intentFamilies: ["calendar_mutate"],
      tags: ["calendar", "recurring", "series"],
      effects: [{ resource: "calendar", mutates: true }],
    },
    {
      id: "calendar.rescheduleEvent",
      description: "Reschedule event(s) with constraints.",
      inputSchema: z.object({
        eventIds: z.array(z.string().min(1)).min(1),
        changes: unknownObject,
      }).strict(),
      outputSchema: z.unknown(),
      readOnly: false,
      riskLevel: "dangerous",
      approvalOperation: "update_calendar_event",
      intentFamilies: ["calendar_mutate", "cross_surface_planning"],
      tags: ["calendar", "reschedule", "move"],
      effects: [{ resource: "calendar", mutates: true }],
    },
    {
      id: "calendar.setWorkingHours",
      description: "Update account working-hours preferences.",
      inputSchema: z.object({
        workHourStart: z.number().int().optional(),
        workHourEnd: z.number().int().optional(),
        workDays: z.array(z.number().int()).optional(),
        timeZone: z.string().optional(),
      }).strict(),
      outputSchema: z.unknown(),
      readOnly: false,
      riskLevel: "caution",
      approvalOperation: "update_preferences",
      intentFamilies: ["calendar_policy"],
      tags: ["calendar", "policy", "working-hours"],
      effects: [{ resource: "preferences", mutates: true }],
    },
    {
      id: "calendar.setWorkingLocation",
      description: "Update working location setting (if provider supports).",
      inputSchema: z.object({
        location: z.string().optional(),
        workingLocation: z.string().optional(),
      }).strict(),
      outputSchema: z.unknown(),
      readOnly: false,
      riskLevel: "caution",
      approvalOperation: "update_preferences",
      intentFamilies: ["calendar_policy"],
      tags: ["calendar", "policy", "location"],
      effects: [{ resource: "preferences", mutates: true }],
    },
    {
      id: "calendar.setOutOfOffice",
      description: "Set out-of-office block for a date range.",
      inputSchema: z.object({
        start: z.string().min(1),
        end: z.string().min(1),
        title: z.string().optional(),
        location: z.string().optional(),
      }).strict(),
      outputSchema: z.unknown(),
      readOnly: false,
      riskLevel: "dangerous",
      approvalOperation: "update_calendar_event",
      intentFamilies: ["calendar_policy", "calendar_mutate"],
      tags: ["calendar", "policy", "ooo"],
      effects: [{ resource: "calendar", mutates: true }],
    },
    {
      id: "calendar.createFocusBlock",
      description: "Create focus/deep-work event block.",
      inputSchema: z.object({
        start: z.string().min(1),
        end: z.string().min(1),
        title: z.string().optional(),
        description: z.string().optional(),
      }).strict(),
      outputSchema: z.unknown(),
      readOnly: false,
      riskLevel: "caution",
      approvalOperation: "update_calendar_event",
      intentFamilies: ["calendar_policy", "calendar_mutate"],
      tags: ["calendar", "focus", "deep-work"],
      effects: [{ resource: "calendar", mutates: true }],
    },
    {
      id: "calendar.createBookingSchedule",
      description: "Store booking link/schedule preference.",
      inputSchema: z.object({
        bookingLink: z.string().url().optional(),
        booking_link: z.string().url().optional(),
      }).strict(),
      outputSchema: z.unknown(),
      readOnly: false,
      riskLevel: "safe",
      approvalOperation: "update_preferences",
      intentFamilies: ["calendar_policy"],
      tags: ["calendar", "booking", "appointments"],
      effects: [{ resource: "preferences", mutates: true }],
    },
    {
      id: "planner.composeDayPlan",
      description: "Compose consolidated day plan summary from prioritized items.",
      inputSchema: z.object({
        topEmailItems: z.array(z.unknown()),
        calendarItems: z.array(z.unknown()),
        focusSuggestions: z.array(z.string()).optional(),
      }).strict(),
      outputSchema: z.unknown(),
      readOnly: true,
      riskLevel: "safe",
      approvalOperation: "analyze",
      intentFamilies: ["cross_surface_planning", "inbox_read", "calendar_read"],
      tags: ["planner", "summary", "daily-plan"],
      effects: [{ resource: "planner", mutates: false }],
    },
    {
      id: "planner.compileMultiActionPlan",
      description: "Compile multiple requested actions into execution plan.",
      inputSchema: z.object({
        actions: z.array(unknownObject),
        constraints: unknownObject.optional(),
      }).strict(),
      outputSchema: z.unknown(),
      readOnly: true,
      riskLevel: "safe",
      approvalOperation: "analyze",
      intentFamilies: ["cross_surface_planning"],
      tags: ["planner", "multi-action", "orchestration"],
      effects: [{ resource: "planner", mutates: false }],
    },
    {
      id: "policy.listRules",
      description: "List unified rule-plane rules by optional type filter.",
      inputSchema: z.object({
        type: z.enum(["guardrail", "automation", "preference"]).optional(),
      }).strict(),
      outputSchema: z.unknown(),
      readOnly: true,
      riskLevel: "safe",
      approvalOperation: "query",
      intentFamilies: ["inbox_controls", "calendar_policy"],
      tags: ["rule", "policy", "guardrail", "automation", "preference", "list"],
      effects: [{ resource: "rule", mutates: false }],
    },
    {
      id: "policy.compileRule",
      description: "Compile a natural-language rule request into canonical preview output.",
      inputSchema: z.object({
        input: z.string().min(1),
      }).strict(),
      outputSchema: z.unknown(),
      readOnly: true,
      riskLevel: "safe",
      approvalOperation: "analyze",
      intentFamilies: ["inbox_controls", "calendar_policy"],
      tags: ["rule", "policy", "compile", "preview", "nl"],
      effects: [{ resource: "rule", mutates: false }],
    },
    {
      id: "policy.createRule",
      description: "Create and optionally activate a canonical rule from natural language.",
      inputSchema: z.object({
        input: z.string().min(1),
        activate: z.boolean().optional(),
      }).strict(),
      outputSchema: z.unknown(),
      readOnly: false,
      riskLevel: "caution",
      approvalOperation: "create_rule",
      intentFamilies: ["inbox_controls", "calendar_policy"],
      tags: ["rule", "policy", "create", "activate", "automation"],
      effects: [{ resource: "rule", mutates: true }],
    },
    {
      id: "policy.updateRule",
      description: "Update an existing canonical rule patch.",
      inputSchema: z.object({
        id: z.string().min(1),
        patch: unknownObject,
      }).strict(),
      outputSchema: z.unknown(),
      readOnly: false,
      riskLevel: "caution",
      approvalOperation: "update_rule",
      intentFamilies: ["inbox_controls", "calendar_policy"],
      tags: ["rule", "policy", "update", "edit"],
      effects: [{ resource: "rule", mutates: true }],
    },
    {
      id: "policy.disableRule",
      description: "Disable a canonical rule immediately or until a timestamp.",
      inputSchema: z.object({
        id: z.string().min(1),
        disabledUntil: z.string().optional(),
      }).strict(),
      outputSchema: z.unknown(),
      readOnly: false,
      riskLevel: "caution",
      approvalOperation: "update_rule",
      intentFamilies: ["inbox_controls", "calendar_policy"],
      tags: ["rule", "policy", "disable", "pause"],
      effects: [{ resource: "rule", mutates: true }],
    },
    {
      id: "policy.deleteRule",
      description: "Delete a canonical rule.",
      inputSchema: z.object({
        id: z.string().min(1),
      }).strict(),
      outputSchema: z.unknown(),
      readOnly: false,
      riskLevel: "dangerous",
      approvalOperation: "delete_rule",
      intentFamilies: ["inbox_controls", "calendar_policy"],
      tags: ["rule", "policy", "delete", "remove"],
      effects: [{ resource: "rule", mutates: true }],
    },
  ];
}

const CAPABILITY_DEFINITIONS = buildCapabilityDefinitions();

export const capabilityRegistry: ReadonlyMap<CapabilityName, CapabilityDefinition> =
  new Map(CAPABILITY_DEFINITIONS.map((cap) => [cap.id, cap]));

let coverageChecked = false;

export function assertCapabilityRegistryCoverage(): void {
  if (coverageChecked) return;
  const declaredCapabilities = new Set(capabilityNameSchema.options);
  const missing = capabilityNameSchema.options.filter((capability) => !capabilityRegistry.has(capability));
  const extra = CAPABILITY_DEFINITIONS.map((definition) => definition.id).filter(
    (capability) => !declaredCapabilities.has(capability),
  );
  if (missing.length > 0 || extra.length > 0) {
    throw new Error(
      `capability_registry_mismatch:missing=${missing.join("|") || "none"};extra=${extra.join("|") || "none"}`,
    );
  }

  const invalid: string[] = [];
  for (const [capability, definition] of capabilityRegistry.entries()) {
    if (!definition.approvalOperation || definition.approvalOperation.trim().length === 0) {
      invalid.push(`${capability}:missing_approval_operation`);
    }
    const hasMutatingEffect = definition.effects.some((effect) => effect.mutates);
    if (definition.readOnly && hasMutatingEffect) {
      invalid.push(`${capability}:readonly_with_mutating_effect`);
    }
    if (!definition.readOnly && !hasMutatingEffect) {
      invalid.push(`${capability}:mutating_without_effect_descriptor`);
    }
  }
  if (invalid.length > 0) {
    throw new Error(`capability_registry_invalid_metadata:${invalid.join(",")}`);
  }

  coverageChecked = true;
}

export function getCapabilityDefinition(
  capability: CapabilityName,
): CapabilityDefinition {
  const def = capabilityRegistry.get(capability);
  if (!def) {
    throw new Error(`unknown_capability_definition:${capability}`);
  }
  return def;
}

export function listCapabilityDefinitions(): CapabilityDefinition[] {
  return CAPABILITY_DEFINITIONS.slice();
}
