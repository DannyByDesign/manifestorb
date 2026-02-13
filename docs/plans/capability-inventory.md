# Capability Inventory (Provider -> Skills Capability Surface)

Status: Phase 0 artifact (required)  
Date: 2026-02-13  
Owner: AI runtime

## Purpose

This inventory converts provider-level operations into a deliberate capability surface for the skills runtime.

Classification:
- `Expose` = include in skills capability layer now
- `Defer` = valid, but postpone to later phase (non-core or low leverage)
- `Remove` = do not expose through AI skills runtime

---

## Email Provider Inventory

Source interface:
- `src/server/features/email/types.ts` (`EmailProvider`)
- `src/server/features/ai/tools/providers/email.ts` adapter implementation

### Read and retrieval operations

| Provider operation | Target capability | Classification | Rationale |
|---|---|---|---|
| `getMessagesWithPagination` | `email.searchThreads` | Expose | Primary inbox search primitive |
| `getThread` / `getThreadMessages` | `email.getThreadMessages` | Expose | Needed for summarize, draft-from-context, reply workflows |
| `getMessage` / `getMessagesBatch` | `email.getMessagesBatch` | Expose | Required for reliable ID/entity resolution |
| `getThreadsWithQuery` | `email.searchThreadsAdvanced` | Expose | Needed for robust semantic query execution |
| `getThreadsWithParticipant` | `email.searchThreadsAdvanced` | Expose | Supports people-centric requests |
| `getThreadsWithLabel` | `email.searchThreadsAdvanced` | Expose | Supports label/category workflows |
| `getLatestMessageInThread` | `email.getLatestMessage` | Expose | Helps referential thread actions |
| `getSentMessages` | `email.searchSent` | Expose | Follow-up and sent-state checks |
| `getInboxMessages` | `email.searchInbox` | Expose | Operational inbox triage |
| `getSentMessageIds` | `email.searchSent` | Expose | Follow-up guard and outbound verification |
| `getDrafts` | `email.listDrafts` | Expose | Draft management |
| `getDraft` | `email.getDraft` | Expose | Draft update/send |
| `getAttachment` | `email.getAttachment` | Defer | Useful but not required for baseline inbox/calendar autonomy |

### Mutation operations

| Provider operation | Target capability | Classification | Rationale |
|---|---|---|---|
| `archiveThread` / `archiveMessage` | `email.batchArchive` | Expose | Core cleanup action |
| `trashThread` | `email.batchTrash` | Expose | Core mutation expected by users |
| `markRead` / `markReadThread` | `email.markReadUnread` | Expose | Core inbox control |
| `labelMessage` | `email.applyLabels` | Expose | Required for labeling workflows |
| `removeThreadLabel(s)` | `email.removeLabels` | Expose | Required for label cleanup |
| `moveThreadToFolder` | `email.moveThread` | Expose | Needed for Outlook-style folder actions |
| `markSpam` | `email.markSpam` | Expose | Standard inbox control |
| `modify` with unsubscribe | `email.unsubscribeSender` | Expose | Core newsletter/subscription management |
| `bulkArchiveFromSenders` | `email.bulkSenderArchive` | Expose | High leverage sender actions |
| `bulkTrashFromSenders` | `email.bulkSenderTrash` | Expose | High leverage sender actions |
| `bulkLabelFromSenders` | `email.bulkSenderLabel` | Expose | High leverage sender actions |
| `blockUnsubscribedEmail` | `email.blockSender` | Expose | Supports sender-level controls |

### Compose / send operations

| Provider operation | Target capability | Classification | Rationale |
|---|---|---|---|
| `createDraft` / `draftEmail` | `email.createDraft` | Expose | Core drafting primitive |
| `updateDraft` | `email.updateDraft` | Expose | Required for iterative drafting |
| `deleteDraft` | `email.deleteDraft` | Expose | Required for draft lifecycle |
| `sendDraft` | `email.sendDraft` | Expose | Core send flow |
| `sendEmail` / `sendEmailWithHtml` | `email.sendNow` | Expose | Needed when user asks to send directly |
| `replyToEmail` | `email.reply` | Expose | Core behavior |
| `forwardEmail` | `email.forward` | Expose | Core behavior |

### Filters / controls / contacts

| Provider operation | Target capability | Classification | Rationale |
|---|---|---|---|
| `getFiltersList` | `email.listFilters` | Expose | Supports filter management |
| `createFilter` / `createAutoArchiveFilter` | `email.createFilter` | Expose | Core automation hygiene |
| `deleteFilter` | `email.deleteFilter` | Expose | Core automation hygiene |
| `searchContacts` | `email.searchContacts` | Defer | Useful quality-of-life; not core for first full-autonomy cut |
| `createContact` | `email.createContact` | Defer | Same as above |
| `getSignatures` | `email.listSignatures` | Defer | Lower leverage for current mission |

### Sync/watch and provider-internal operations

| Provider operation | Target capability | Classification | Rationale |
|---|---|---|---|
| `processHistory` | N/A | Remove | Internal sync operation, not user-invoked assistant action |
| `watchEmails` / `unwatchEmails` | N/A | Remove | Service-level infra concern, not direct user task |
| `getAccessToken` | N/A | Remove | Security-sensitive internal primitive |
| `isReplyInThread` / `isSentMessage` | N/A | Remove | Internal helper semantics only |
| `hasPreviousCommunicationsWithSenderOrDomain` | `email.relationshipSignals` | Defer | Could improve prioritization later |
| `checkIfReplySent` / `countReceivedMessages` | `email.followupSignals` | Defer | Useful for advanced follow-up pack |

---

## Calendar Provider Inventory

Source interfaces:
- `src/server/features/calendar/event-types.ts` (`CalendarEventProvider`)
- `src/server/features/ai/tools/providers/calendar.ts` adapter

### Read/discovery operations

| Provider operation | Target capability | Classification | Rationale |
|---|---|---|---|
| `fetchEvents` / adapter `searchEvents` | `calendar.listEvents` | Expose | Core event listing/search |
| `fetchEventsWithAttendee` | `calendar.searchEventsByAttendee` | Expose | Required for scheduling flows |
| `getEvent` | `calendar.getEvent` | Expose | Required for safe updates/deletes |
| `findAvailableSlots` | `calendar.findAvailability` | Expose | Core assistant value |

### Mutation operations

| Provider operation | Target capability | Classification | Rationale |
|---|---|---|---|
| `createEvent` | `calendar.createEvent` | Expose | Core capability |
| `updateEvent` | `calendar.updateEvent` | Expose | Core capability |
| `deleteEvent` | `calendar.deleteEvent` | Expose | Core capability |
| update w/ attendee edits | `calendar.manageAttendees` | Expose | Required for practical autonomy |
| update w/ recurrence mode | `calendar.updateRecurringMode` | Expose | Must handle instance vs series safely |

### Calendar settings and policy operations

| Adapter operation | Target capability | Classification | Rationale |
|---|---|---|---|
| `setWorkingHours` (capability facade) | `calendar.setWorkingHours` | Expose | Existing and high value |
| `setOutOfOffice` (capability facade) | `calendar.setOutOfOffice` | Expose | Existing and high value |
| `createFocusBlock` (capability facade) | `calendar.createFocusBlock` | Expose | Existing and high value |
| `createBookingSchedule` (capability facade) | `calendar.createBookingSchedule` | Expose | Existing and high value |
| working location setting | `calendar.setWorkingLocation` | Expose | Expected by users for work planning |

---

## Cross-surface / planning inventory

| Operation | Target capability | Classification | Rationale |
|---|---|---|---|
| Compose daily plan from inbox + calendar context | `planner.composeDayPlan` | Expose | Existing and core to daily workflow |
| Multi-intent transaction planning | `planner.compileMultiActionPlan` | Expose | Needed for “do X and Y” requests |
| Domain-specific policy packs | N/A | Defer | Future phase, out of current baseline |

---

## Final Expose Set (current execution target)

The following capability set is the minimum to claim practical “full autonomy” for inbox/calendar:

### Email

- `email.searchThreads`
- `email.searchThreadsAdvanced`
- `email.getThreadMessages`
- `email.getMessagesBatch`
- `email.getLatestMessage`
- `email.searchSent`
- `email.searchInbox`
- `email.listDrafts`
- `email.getDraft`
- `email.createDraft`
- `email.updateDraft`
- `email.deleteDraft`
- `email.sendDraft`
- `email.sendNow`
- `email.reply`
- `email.forward`
- `email.batchArchive`
- `email.batchTrash`
- `email.markReadUnread`
- `email.applyLabels`
- `email.removeLabels`
- `email.moveThread`
- `email.markSpam`
- `email.unsubscribeSender`
- `email.blockSender`
- `email.bulkSenderArchive`
- `email.bulkSenderTrash`
- `email.bulkSenderLabel`
- `email.listFilters`
- `email.createFilter`
- `email.deleteFilter`

### Calendar

- `calendar.listEvents`
- `calendar.searchEventsByAttendee`
- `calendar.getEvent`
- `calendar.findAvailability`
- `calendar.createEvent`
- `calendar.updateEvent`
- `calendar.deleteEvent`
- `calendar.manageAttendees`
- `calendar.updateRecurringMode`
- `calendar.setWorkingHours`
- `calendar.setOutOfOffice`
- `calendar.createFocusBlock`
- `calendar.createBookingSchedule`
- `calendar.setWorkingLocation`

### Planner

- `planner.composeDayPlan`
- `planner.compileMultiActionPlan`

---

## Notes for implementation phases

- All `Expose` operations must be wrapped in strict capability facades with normalized error taxonomy.
- `Remove` operations stay internal and must not be directly callable by skill plans.
- `Defer` items can be added later without architecture changes because compiler/executor boundaries remain stable.
