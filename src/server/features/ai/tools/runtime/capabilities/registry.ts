import { z } from "zod";

export type ToolName = string;

export type CapabilityRiskLevel = "safe" | "caution" | "dangerous";
export type CapabilityIntentFamily =
  | "inbox_read"
  | "inbox_mutate"
  | "inbox_compose"
  | "inbox_controls"
  | "calendar_read"
  | "calendar_mutate"
  | "calendar_policy"
  | "cross_surface_planning"
  | "memory_read"
  | "memory_mutate"
  | "web_read";

export interface CapabilityEffectDescriptor {
  resource: "email" | "calendar" | "planner" | "preferences" | "rule" | "task" | "knowledge";
  mutates: boolean;
}

export interface CapabilityDefinition {
  id: ToolName;
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

const primitiveValueSchema = z.union([
  z.string(),
  z.number(),
  z.boolean(),
  z.null(),
]);
const primitiveArraySchema = z.array(primitiveValueSchema);
const objectLevel1Schema = z.record(
  z.string(),
  z.union([primitiveValueSchema, primitiveArraySchema]),
);
const objectLevel1ArraySchema = z.array(objectLevel1Schema);
const objectLevel2Schema = z.record(
  z.string(),
  z.union([
    primitiveValueSchema,
    primitiveArraySchema,
    objectLevel1Schema,
    objectLevel1ArraySchema,
  ]),
);
const objectLevel2ArraySchema = z.array(objectLevel2Schema);
const unknownObject = z.record(
  z.string(),
  z.union([
    primitiveValueSchema,
    primitiveArraySchema,
    objectLevel1Schema,
    objectLevel1ArraySchema,
    objectLevel2Schema,
    objectLevel2ArraySchema,
  ]),
);
const emailSearchInputSchema = z.object({
  query: z.string().optional(),
  mailbox: z.enum(["inbox", "sent"]).optional(),
  limit: z.number().int().positive().max(5000).optional(),
  fetchAll: z.boolean().optional(),
  includeNonPrimary: z.boolean().optional(),
  subscriptionsOnly: z.boolean().optional(),
  purpose: z.enum(["lookup", "list", "count"]).optional(),
  dateRange: z
    .object({
      before: z.string().optional(),
      after: z.string().optional(),
      timeZone: z.string().optional(),
      timezone: z.string().optional(),
    })
    .optional(),
  timeZone: z.string().optional(),
  timezone: z.string().optional(),
  subjectContains: z.string().optional(),
  bodyContains: z.string().optional(),
  text: z.string().optional(),
  from: z.string().optional(),
  to: z.string().optional(),
  cc: z.string().optional(),
  fromConcept: z.string().optional(),
  toConcept: z.string().optional(),
  ccConcept: z.string().optional(),
  fromEmails: z.array(z.string().min(1)).max(50).optional(),
  fromDomains: z.array(z.string().min(1)).max(50).optional(),
  toEmails: z.array(z.string().min(1)).max(50).optional(),
  toDomains: z.array(z.string().min(1)).max(50).optional(),
  ccEmails: z.array(z.string().min(1)).max(50).optional(),
  ccDomains: z.array(z.string().min(1)).max(50).optional(),
  category: z.enum(["primary", "promotions", "social", "updates", "forums"]).optional(),
  hasAttachment: z.boolean().optional(),
  unread: z.boolean().optional(),
  sort: z.enum(["relevance", "newest", "oldest"]).optional(),
  sentByMe: z.boolean().optional(),
  receivedByMe: z.boolean().optional(),
  strictSenderOnly: z.boolean().optional(),
  attachmentMimeTypes: z.array(z.string().min(1)).max(20).optional(),
  attachmentFilenameContains: z.string().optional(),
  unrepliedToSent: z.boolean().optional(),
});
const idListSchema = z.object({ ids: z.array(z.string().min(1)).min(1) }).strict();
const threadIdSchema = z.object({ threadId: z.string().min(1) }).strict();
// Allow missing ids so the tool can return a structured clarification instead of failing admission.
const draftIdSchema = z.object({ draftId: z.string().optional() }).strict();
const eventIdSchema = z.object({
  eventId: z.string().min(1),
  calendarId: z.string().min(1).optional(),
}).strict();

const emailBulkTargetBaseSchema = z
  .object({
    ids: z.array(z.string().min(1)).min(1).optional(),
    filter: emailSearchInputSchema.optional(),
    limit: z.number().int().min(1).max(5000).optional(),
  })
  .strict();

function withEmailBulkTargetGuard<T extends z.ZodTypeAny>(schema: T): T {
  return schema.superRefine((value: unknown, ctx) => {
    if (!value || typeof value !== "object" || Array.isArray(value)) return;
    const record = value as { ids?: string[]; filter?: unknown };
    if ((!record.ids || record.ids.length === 0) && !record.filter) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Either ids or filter is required.",
        path: ["ids"],
      });
    }
  }) as T;
}

const emailBulkTargetSchema = withEmailBulkTargetGuard(emailBulkTargetBaseSchema);
const emailFacetInputSchema = z
  .object({
    filter: emailSearchInputSchema.optional(),
    scanLimit: z.number().int().min(20).max(800).optional(),
    maxFacets: z.number().int().min(3).max(25).optional(),
  })
  .strict();
const emailCountUnreadInputSchema = emailSearchInputSchema
  .extend({
    scope: z.enum(["inbox", "primary", "all"]).optional(),
  })
  .strict();

function buildCapabilityDefinitions(): CapabilityDefinition[] {
  return [
    {
      id: "email.getUnreadCount",
      description: "Return unread inbox count using provider-level counters.",
      inputSchema: z
        .object({
          scope: z.enum(["inbox", "primary", "all"]).optional(),
        })
        .strict(),
      outputSchema: z.unknown(),
      readOnly: true,
      riskLevel: "safe",
      approvalOperation: "query",
      intentFamilies: ["inbox_read"],
      tags: ["email", "count", "unread", "inbox"],
      effects: [{ resource: "email", mutates: false }],
    },
    {
      id: "email.countUnread",
      description:
        "Count unread email with optional date/filter constraints (use for 'today', ranges, and scoped unread counts).",
      inputSchema: emailCountUnreadInputSchema,
      outputSchema: z.unknown(),
      readOnly: true,
      riskLevel: "safe",
      approvalOperation: "query",
      intentFamilies: ["inbox_read"],
      tags: ["email", "count", "unread", "date_range"],
      effects: [{ resource: "email", mutates: false }],
    },
    {
      id: "email.searchThreads",
      description: "Search inbox threads using query/filter constraints.",
      inputSchema: emailSearchInputSchema,
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
      description:
        "Advanced thread search using rich filter constraints (use unrepliedToSent=true for 'sent but no reply yet').",
      inputSchema: emailSearchInputSchema,
      outputSchema: z.unknown(),
      readOnly: true,
      riskLevel: "safe",
      approvalOperation: "query",
      intentFamilies: ["inbox_read", "cross_surface_planning"],
      tags: ["email", "search", "advanced", "unreplied", "awaiting_reply"],
      effects: [{ resource: "email", mutates: false }],
    },
    {
      id: "email.facetThreads",
      description:
        "Aggregate matching threads by top senders/domains to help with clarification (no guessing).",
      inputSchema: emailFacetInputSchema,
      outputSchema: z.unknown(),
      readOnly: true,
      riskLevel: "safe",
      approvalOperation: "query",
      intentFamilies: ["inbox_read", "cross_surface_planning"],
      tags: ["email", "search", "facets", "clarification"],
      effects: [{ resource: "email", mutates: false }],
    },
    {
      id: "email.searchSent",
      description:
        "Search sent mailbox messages and threads using query/filter constraints (use unrepliedToSent=true for 'sent but no reply yet').",
      inputSchema: emailSearchInputSchema,
      outputSchema: z.unknown(),
      readOnly: true,
      riskLevel: "safe",
      approvalOperation: "query",
      intentFamilies: ["inbox_read"],
      tags: ["email", "search", "sent", "unreplied", "awaiting_reply"],
      effects: [{ resource: "email", mutates: false }],
    },
    {
      id: "email.searchInbox",
      description: "Search inbox-focused messages and threads.",
      inputSchema: emailSearchInputSchema,
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
      inputSchema: emailBulkTargetSchema,
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
      inputSchema: emailBulkTargetSchema,
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
      inputSchema: withEmailBulkTargetGuard(
        emailBulkTargetBaseSchema.extend({ read: z.boolean() }).strict(),
      ),
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
      inputSchema: withEmailBulkTargetGuard(
        emailBulkTargetBaseSchema
          .extend({ labelIds: z.array(z.string().min(1)).min(1) })
          .strict(),
      ),
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
      inputSchema: withEmailBulkTargetGuard(
        emailBulkTargetBaseSchema
          .extend({ labelIds: z.array(z.string().min(1)).min(1) })
          .strict(),
      ),
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
      inputSchema: withEmailBulkTargetGuard(
        emailBulkTargetBaseSchema.extend({ folderName: z.string().min(1) }).strict(),
      ),
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
        cc: z.array(z.string().email()).optional(),
        bcc: z.array(z.string().email()).optional(),
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
        parentId: z.string().optional(),
        body: z.string().optional(),
        subject: z.string().optional(),
        mode: z.enum(["send", "draft"]).optional(),
        replyAll: z.boolean().optional(),
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
        parentId: z.string().optional(),
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
      id: "calendar.detectConflicts",
      description: "Detect overlaps/conflicts between calendar events in a window.",
      inputSchema: unknownObject,
      outputSchema: z.unknown(),
      readOnly: true,
      riskLevel: "safe",
      approvalOperation: "query",
      intentFamilies: ["calendar_read", "cross_surface_planning"],
      tags: ["calendar", "conflicts", "overlaps", "schedule"],
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
      id: "calendar.listCalendars",
      description: "List connected calendars and their enabled/primary state.",
      inputSchema: z.object({}).strict(),
      outputSchema: z.unknown(),
      readOnly: true,
      riskLevel: "safe",
      approvalOperation: "query",
      intentFamilies: ["calendar_read", "calendar_policy"],
      tags: ["calendar", "list", "calendars", "selection"],
      effects: [{ resource: "calendar", mutates: false }],
    },
    {
      id: "calendar.setEnabledCalendars",
      description: "Enable/disable calendars for search and availability calculations.",
      inputSchema: z.object({
        enableIds: z.array(z.string().min(1)).optional(),
        disableIds: z.array(z.string().min(1)).optional(),
        enableOnlyIds: z.array(z.string().min(1)).optional(),
        enablePrimaryNonNoisy: z.boolean().optional(),
      }).strict(),
      outputSchema: z.unknown(),
      readOnly: false,
      riskLevel: "caution",
      approvalOperation: "update_preferences",
      intentFamilies: ["calendar_policy"],
      tags: ["calendar", "selection", "enable", "disable"],
      effects: [{ resource: "preferences", mutates: true }],
    },
    {
      id: "calendar.setSelectedCalendars",
      description: "Set the specific calendars used for availability and scheduling.",
      inputSchema: z.object({
        selectedCalendarIds: z.array(z.string().min(1)).min(1),
      }).strict(),
      outputSchema: z.unknown(),
      readOnly: false,
      riskLevel: "caution",
      approvalOperation: "update_preferences",
      intentFamilies: ["calendar_policy"],
      tags: ["calendar", "selection", "preferences"],
      effects: [{ resource: "preferences", mutates: true }],
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
        eventIds: z.array(z.string().min(1)).optional(),
        filter: unknownObject.optional(),
        changes: unknownObject.optional(),
      })
        .strict()
        .superRefine((value, ctx) => {
          const hasIds = Array.isArray(value.eventIds) && value.eventIds.length > 0;
          const hasFilter = Boolean(value.filter && typeof value.filter === "object");
          if (!hasIds && !hasFilter) {
            ctx.addIssue({
              code: z.ZodIssueCode.custom,
              message: "Provide eventIds or a filter to identify the event(s) to reschedule.",
              path: ["eventIds"],
            });
          }
        }),
      outputSchema: z.unknown(),
      readOnly: false,
      riskLevel: "dangerous",
      approvalOperation: "update_calendar_event",
      intentFamilies: ["calendar_mutate", "cross_surface_planning"],
      tags: ["calendar", "reschedule", "move"],
      effects: [{ resource: "calendar", mutates: true }],
    },
    {
      id: "task.reschedule",
      description:
        "Reschedule a task block and, when linked, update its calendar event too.",
      inputSchema: z
        .object({
          taskId: z.string().min(1).optional(),
          taskTitle: z.string().min(1).optional(),
          changes: unknownObject.optional(),
        })
        .strict()
        .superRefine((value, ctx) => {
          if (!value.taskId && !value.taskTitle) {
            ctx.addIssue({
              code: z.ZodIssueCode.custom,
              message: "Either taskId or taskTitle is required.",
              path: ["taskId"],
            });
          }
        }),
      outputSchema: z.unknown(),
      readOnly: false,
      riskLevel: "caution",
      approvalOperation: "update_task",
      intentFamilies: ["calendar_mutate", "cross_surface_planning"],
      tags: ["task", "calendar", "reschedule", "move", "schedule"],
      effects: [{ resource: "task", mutates: true }],
    },
    {
      id: "task.list",
      description: "List tasks with optional due-date and status-scope filters (active/completed/all).",
      inputSchema: unknownObject,
      outputSchema: z.unknown(),
      readOnly: true,
      riskLevel: "safe",
      approvalOperation: "query",
      intentFamilies: ["calendar_read", "cross_surface_planning"],
      tags: ["task", "list", "due"],
      effects: [{ resource: "task", mutates: false }],
    },
    {
      id: "task.bulkReschedule",
      description: "Bulk reschedule tasks using a shared window constraint.",
      inputSchema: unknownObject,
      outputSchema: z.unknown(),
      readOnly: false,
      riskLevel: "caution",
      approvalOperation: "update_task",
      intentFamilies: ["calendar_mutate", "cross_surface_planning"],
      tags: ["task", "bulk", "reschedule", "schedule"],
      effects: [{ resource: "task", mutates: true }],
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
        date: z.string().optional(),
        start: z.string().optional(),
        end: z.string().optional(),
        timeZone: z.string().optional(),
      }).strict(),
      outputSchema: z.unknown(),
      readOnly: false,
      riskLevel: "caution",
      approvalOperation: "update_calendar_event",
      intentFamilies: ["calendar_policy", "calendar_mutate"],
      tags: ["calendar", "policy", "location"],
      effects: [{ resource: "calendar", mutates: true }],
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
      id: "memory.remember",
      description: "Persist a durable user memory fact for future recall.",
      inputSchema: z.object({
        key: z.string().min(3).max(100),
        value: z.string().min(1).max(1000),
        confidence: z.number().min(0).max(1).optional(),
      }).strict(),
      outputSchema: z.unknown(),
      readOnly: false,
      riskLevel: "safe",
      approvalOperation: "update_preferences",
      intentFamilies: ["memory_mutate", "cross_surface_planning"],
      tags: ["memory", "remember", "facts", "preferences"],
      effects: [{ resource: "preferences", mutates: true }],
    },
    {
      id: "memory.recall",
      description: "Recall relevant memory facts using hybrid semantic and lexical search.",
      inputSchema: z.object({
        query: z.string().min(1).max(250),
        limit: z.number().int().min(1).max(25).optional(),
        minScore: z.number().min(0).max(1).optional(),
      }).strict(),
      outputSchema: z.unknown(),
      readOnly: true,
      riskLevel: "safe",
      approvalOperation: "query",
      intentFamilies: ["memory_read", "cross_surface_planning", "inbox_read", "calendar_read"],
      tags: ["memory", "recall", "search", "history", "contacts"],
      effects: [{ resource: "preferences", mutates: false }],
    },
    {
      id: "memory.forget",
      description: "Deactivate a stored memory fact when the user asks to forget it.",
      inputSchema: z.object({
        key: z.string().min(1),
      }).strict(),
      outputSchema: z.unknown(),
      readOnly: false,
      riskLevel: "caution",
      approvalOperation: "update_preferences",
      intentFamilies: ["memory_mutate", "cross_surface_planning"],
      tags: ["memory", "forget", "delete"],
      effects: [{ resource: "preferences", mutates: true }],
    },
    {
      id: "memory.list",
      description: "List currently active memory facts for the user.",
      inputSchema: z.object({
        limit: z.number().int().min(1).max(50).optional(),
      }).strict(),
      outputSchema: z.unknown(),
      readOnly: true,
      riskLevel: "safe",
      approvalOperation: "query",
      intentFamilies: ["memory_read", "cross_surface_planning"],
      tags: ["memory", "list", "facts"],
      effects: [{ resource: "preferences", mutates: false }],
    },
    {
      id: "web.search",
      description: "Search the public web with provider-backed search APIs.",
      inputSchema: z.object({
        query: z.string().min(1),
        count: z.number().int().min(1).max(10).optional(),
        country: z.string().min(1).max(12).optional(),
        search_lang: z.string().min(1).max(12).optional(),
        ui_lang: z.string().min(1).max(12).optional(),
        freshness: z.string().min(1).max(64).optional(),
        enrichTopK: z.number().int().min(0).max(3).optional(),
        enrichExtractMode: z.enum(["markdown", "text"]).optional(),
        enrichMaxChars: z.number().int().min(500).max(25_000).optional(),
      }).strict(),
      outputSchema: z.unknown(),
      readOnly: true,
      riskLevel: "safe",
      approvalOperation: "query",
      intentFamilies: ["web_read", "cross_surface_planning"],
      tags: ["web", "search", "research", "internet"],
      effects: [{ resource: "knowledge", mutates: false }],
    },
    {
      id: "web.fetch",
      description: "Fetch and extract readable content from a public URL.",
      inputSchema: z.object({
        url: z.string().url(),
        extractMode: z.enum(["markdown", "text"]).optional(),
        maxChars: z.number().int().min(100).max(200_000).optional(),
      }).strict(),
      outputSchema: z.unknown(),
      readOnly: true,
      riskLevel: "safe",
      approvalOperation: "get",
      intentFamilies: ["web_read", "cross_surface_planning"],
      tags: ["web", "fetch", "url", "extract", "content"],
      effects: [{ resource: "knowledge", mutates: false }],
    },
    {
      id: "planner.composeDayPlan",
      description: "Compose consolidated day plan summary from prioritized items.",
      inputSchema: z.object({
        topEmailItems: z.array(unknownObject).optional(),
        calendarItems: z.array(unknownObject).optional(),
        focusSuggestions: z.array(z.string()).optional(),
        request: z.string().max(2000).optional(),
        day: z.string().optional(),
        start: z.string().optional(),
        end: z.string().optional(),
        execute: z.boolean().optional(),
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
        request: z.string().max(2000).optional(),
        execute: z.boolean().optional(),
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
        id: z.string().min(1).optional(),
        target: z.string().min(1).optional(),
        type: z.enum(["guardrail", "automation", "preference"]).optional(),
        patch: unknownObject,
      }).strict().superRefine((value, context) => {
        if (!value.id && !value.target) {
          context.addIssue({
            code: z.ZodIssueCode.custom,
            message: "Either id or target is required.",
            path: ["id"],
          });
        }
      }),
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
        id: z.string().min(1).optional(),
        target: z.string().min(1).optional(),
        type: z.enum(["guardrail", "automation", "preference"]).optional(),
        disabledUntil: z.string().optional(),
      }).strict().superRefine((value, context) => {
        if (!value.id && !value.target) {
          context.addIssue({
            code: z.ZodIssueCode.custom,
            message: "Either id or target is required.",
            path: ["id"],
          });
        }
      }),
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
        id: z.string().min(1).optional(),
        target: z.string().min(1).optional(),
        type: z.enum(["guardrail", "automation", "preference"]).optional(),
      }).strict().superRefine((value, context) => {
        if (!value.id && !value.target) {
          context.addIssue({
            code: z.ZodIssueCode.custom,
            message: "Either id or target is required.",
            path: ["id"],
          });
        }
      }),
      outputSchema: z.unknown(),
      readOnly: false,
      riskLevel: "dangerous",
      approvalOperation: "delete_rule",
      intentFamilies: ["inbox_controls", "calendar_policy"],
      tags: ["rule", "policy", "delete", "remove"],
      effects: [{ resource: "rule", mutates: true }],
    },
    {
      id: "policy.explainLastDecision",
      description: "Explain why a recent tool action was blocked or required approval.",
      inputSchema: z.object({
        limit: z.number().int().min(1).max(10).optional(),
      }).strict(),
      outputSchema: z.unknown(),
      readOnly: true,
      riskLevel: "safe",
      approvalOperation: "query",
      intentFamilies: ["inbox_controls", "calendar_policy"],
      tags: ["rule", "policy", "explain", "blocked", "approval"],
      effects: [{ resource: "rule", mutates: false }],
    },
    {
      id: "policy.dryRunRule",
      description: "Dry-run a rule against current inbox/calendar to preview what would match.",
      inputSchema: z.object({
        id: z.string().min(1).optional(),
        target: z.string().min(1).optional(),
        type: z.enum(["guardrail", "automation", "preference"]).optional(),
        limit: z.number().int().min(1).max(50).optional(),
      }).strict().superRefine((value, context) => {
        if (!value.id && !value.target) {
          context.addIssue({
            code: z.ZodIssueCode.custom,
            message: "Either id or target is required.",
            path: ["id"],
          });
        }
      }),
      outputSchema: z.unknown(),
      readOnly: true,
      riskLevel: "safe",
      approvalOperation: "analyze",
      intentFamilies: ["inbox_controls", "calendar_policy", "cross_surface_planning"],
      tags: ["rule", "policy", "dry-run", "preview", "match"],
      effects: [{ resource: "rule", mutates: false }],
    },
  ];
}

const CAPABILITY_DEFINITIONS = buildCapabilityDefinitions();

export const toolDefinitionRegistry: ReadonlyMap<ToolName, CapabilityDefinition> =
  new Map(CAPABILITY_DEFINITIONS.map((cap) => [cap.id, cap]));

let coverageChecked = false;

export function assertCapabilityRegistryCoverage(): void {
  if (coverageChecked) return;
  if (CAPABILITY_DEFINITIONS.length === 0) {
    throw new Error("capability_registry_empty");
  }

  const invalid: string[] = [];
  for (const [toolName, definition] of toolDefinitionRegistry.entries()) {
    if (!definition.approvalOperation || definition.approvalOperation.trim().length === 0) {
      invalid.push(`${toolName}:missing_approval_operation`);
    }
    const hasMutatingEffect = definition.effects.some((effect) => effect.mutates);
    if (definition.readOnly && hasMutatingEffect) {
      invalid.push(`${toolName}:readonly_with_mutating_effect`);
    }
    if (!definition.readOnly && !hasMutatingEffect) {
      invalid.push(`${toolName}:mutating_without_effect_descriptor`);
    }
  }
  if (invalid.length > 0) {
    throw new Error(`capability_registry_invalid_metadata:${invalid.join(",")}`);
  }

  coverageChecked = true;
}

export function getToolDefinition(
  toolName: ToolName,
): CapabilityDefinition {
  const def = toolDefinitionRegistry.get(toolName);
  if (!def) {
    throw new Error(`unknown_tool_definition:${toolName}`);
  }
  return def;
}

export function listToolDefinitions(): CapabilityDefinition[] {
  return CAPABILITY_DEFINITIONS.slice();
}
