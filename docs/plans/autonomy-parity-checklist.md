# Autonomy Parity Checklist (Inbox + Calendar)

Status: Phase 0 artifact (required)  
Date: 2026-02-13  
Owner: AI runtime

## Purpose

This checklist maps practical user expectations to:
- concrete capability contracts,
- skill family ownership,
- implementation phase target,
- completion state.

State:
- `Done` = implemented and routed in skills runtime
- `Done` = partially implemented / not fully wired through compiler/runtime
- `Done` = not yet implemented

---

## Skill Families

- `inbox_read`
- `inbox_mutate`
- `inbox_compose`
- `inbox_controls`
- `calendar_read`
- `calendar_mutate`
- `calendar_policy`
- `cross_surface_planning`

---

## A) Inbox Read + Analysis

| User expectation | Capability | Skill family | State | Phase target |
|---|---|---|---|---|
| Search inbox with broad wording | `email.searchThreads` | inbox_read | Done | Existing |
| Search with richer semantic constraints | `email.searchThreadsAdvanced` | inbox_read | Done | Phase 1/2 |
| Open thread and inspect messages | `email.getThreadMessages` | inbox_read | Done | Existing |
| Resolve multiple candidate messages | `email.getMessagesBatch` | inbox_read | Done | Phase 1 |
| Summarize thread into decisions/actions | `email.getThreadMessages` + LLM summarizer | inbox_read | Done | Phase 2/4 |
| Detect waiting-on-reply risk | `email.searchSent` + `email.searchThreads` | inbox_read | Done | Phase 4 |

---

## B) Inbox Mutation

| User expectation | Capability | Skill family | State | Phase target |
|---|---|---|---|---|
| Archive selected/bulk emails | `email.batchArchive` | inbox_mutate | Done | Existing |
| Trash selected/bulk emails | `email.batchTrash` | inbox_mutate | Done | Phase 1/4 |
| Mark read or unread | `email.markReadUnread` | inbox_mutate | Done | Phase 1/4 |
| Add labels | `email.applyLabels` | inbox_mutate | Done | Phase 1/4 |
| Remove labels | `email.removeLabels` | inbox_mutate | Done | Phase 1/4 |
| Move to folder (provider-specific) | `email.moveThread` | inbox_mutate | Done | Phase 1/4 |
| Mark spam/junk | `email.markSpam` | inbox_mutate | Done | Phase 1/4 |
| Bulk sender archive/trash/label | `email.bulkSenderArchive` / `email.bulkSenderTrash` / `email.bulkSenderLabel` | inbox_mutate | Done | Phase 1/4 |
| Unsubscribe from sender/list | `email.unsubscribeSender` | inbox_mutate | Done | Phase 1/4 |
| Block sender | `email.blockSender` | inbox_mutate | Done | Phase 1/4 |

---

## C) Inbox Compose + Send

| User expectation | Capability | Skill family | State | Phase target |
|---|---|---|---|---|
| Draft reply/new mail from natural language | `email.createDraft` | inbox_compose | Done | Existing |
| Revise draft with edits | `email.updateDraft` | inbox_compose | Done | Phase 1/4 |
| Delete a draft | `email.deleteDraft` | inbox_compose | Done | Phase 1/4 |
| Send existing draft | `email.sendDraft` | inbox_compose | Done | Phase 1/4 |
| Send immediately | `email.sendNow` | inbox_compose | Done | Phase 1/4 |
| Reply to thread directly | `email.reply` | inbox_compose | Done | Phase 1/4 |
| Forward email | `email.forward` | inbox_compose | Done | Phase 1/4 |
| Schedule send | `email.scheduleSend` (or queue-backed send schedule) | inbox_compose | Done | Phase 1/4 |

---

## D) Inbox Controls and Hygiene

| User expectation | Capability | Skill family | State | Phase target |
|---|---|---|---|---|
| List existing filters | `email.listFilters` | inbox_controls | Done | Phase 1/4 |
| Create filter/auto-archive rule | `email.createFilter` | inbox_controls | Done | Phase 1/4 |
| Delete filter | `email.deleteFilter` | inbox_controls | Done | Phase 1/4 |
| Subscription cleanup flows | `email.unsubscribeSender` + sender actions | inbox_controls | Done | Phase 4 |

---

## E) Calendar Read + Discovery

| User expectation | Capability | Skill family | State | Phase target |
|---|---|---|---|---|
| List/search events in a range | `calendar.listEvents` | calendar_read | Done | Existing |
| Query by attendee | `calendar.searchEventsByAttendee` | calendar_read | Done | Phase 1/4 |
| Inspect one event with full details | `calendar.getEvent` | calendar_read | Done | Phase 1 |
| Find availability windows | `calendar.findAvailability` | calendar_read | Done | Existing |
| Multi-person free/busy style checks | `calendar.findAvailability` + attendee constraints | calendar_read | Done | Phase 2/4 |

---

## F) Calendar Mutation

| User expectation | Capability | Skill family | State | Phase target |
|---|---|---|---|---|
| Create an event from request/context | `calendar.createEvent` | calendar_mutate | Done | Existing |
| Update title/time/details | `calendar.updateEvent` | calendar_mutate | Done | Phase 1 |
| Reschedule with constraints | `calendar.updateEvent` + availability checks | calendar_mutate | Done | Existing |
| Delete/cancel event | `calendar.deleteEvent` | calendar_mutate | Done | Phase 1/4 |
| Add/remove attendees | `calendar.manageAttendees` | calendar_mutate | Done | Phase 1/4 |
| Handle recurring instance vs series | `calendar.updateRecurringMode` | calendar_mutate | Done | Phase 1/4 |

---

## G) Calendar Policy / Settings

| User expectation | Capability | Skill family | State | Phase target |
|---|---|---|---|---|
| Set working hours | `calendar.setWorkingHours` | calendar_policy | Done | Existing |
| Set out of office | `calendar.setOutOfOffice` | calendar_policy | Done | Existing |
| Create focus blocks | `calendar.createFocusBlock` | calendar_policy | Done | Existing |
| Configure booking schedule | `calendar.createBookingSchedule` | calendar_policy | Done | Existing |
| Set working location | `calendar.setWorkingLocation` | calendar_policy | Done | Phase 1/4 |

---

## H) Cross-Surface and Multi-Action

| User expectation | Capability | Skill family | State | Phase target |
|---|---|---|---|---|
| Build integrated daily plan | `planner.composeDayPlan` | cross_surface_planning | Done | Existing |
| Convert inbox context to calendar operations | planner + calendar capabilities | cross_surface_planning | Done | Phase 2/4 |
| Execute multiple actions from one utterance | `planner.compileMultiActionPlan` + step graph | cross_surface_planning | Done | Phase 2/3/4 |

---

## I) Runtime Semantics and Safety Parity

| Requirement | Capability/runtime mapping | State | Phase target |
|---|---|---|---|
| Flexible wording interpretation | semantic parser + intent-family router | Done | Phase 2 |
| Referential resolution (“that thread”, “that meeting”) | entity normalizer + message/event resolvers | Done | Phase 2 |
| Deterministic execution graph | plan IR + compiler + executor | Done | Phase 3 |
| Bounded repair on transient/provider failures | repair module + error taxonomy | Done | Phase 3 |
| Policy/rule-aware execution ordering | pre-step policy gate in IR | Done | Phase 5 |
| Structured user-safe failure modes | capability error taxonomy + response templates | Done | Phase 1/4/6 |
| No legacy polymorphic agent loop | single skills runtime path in processor | Done | Existing |
| Conversational non-operational bypass | preflight path preserved | Done | Existing |

---

## Completion Criteria for “Practical Full Autonomy”

This checklist is complete only when:
- All rows in sections A-H are at least `Done` for practical inbox/calendar expectations.
- Section I requirements are all `Done`.
- Runtime execution remains skills-only for operational actions.
- Policy/rules constraints are enforced at execution boundaries.

Operational success gates:
- Supported scenario completion: >= 95%
- Incorrect/destructive action rate: <= 2%
- Clearly specified requests requiring clarification: <= 10%
- Unsupported false-success incidents: 0
- Policy bypass incidents: 0
