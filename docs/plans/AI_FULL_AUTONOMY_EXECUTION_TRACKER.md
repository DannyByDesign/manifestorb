# AI Full Autonomy Execution Tracker (Inbox + Calendar)

Status: Completed implementation tracker (audit + build)
Owner: AI runtime team
Last updated: 2026-02-13 (execution complete)
Primary outcome: a production-ready, skills-driven assistant that can interpret varied natural language and reliably execute the full practical inbox/calendar surface through deterministic capability contracts.

---

## 1) What this tracker is, and what you get

This document is both:
- an audit plan (what is missing today, exactly where, and why), and
- an implementation plan (atomic build tasks with acceptance criteria and edge cases).

If fully executed, the resulting system is:
- skills-first (no legacy polymorphic tool loop in production path),
- semantically flexible (handles varied user wording and multi-step requests),
- capability-complete for practical inbox/calendar workflows,
- wired to existing approval/rules constraints at runtime boundaries,
- observable and debuggable in production.

This tracker intentionally deprioritizes broad test-suite expansion. It focuses on architecture correctness, deterministic execution, runtime telemetry, and production-safe behavior.

---

## 2) Hard architecture boundaries (non-negotiable)

1. Core runtime is domain-agnostic:
- routing
- slot/entity extraction
- plan compiler
- deterministic executor
- policy/approval enforcement
- idempotency/retry
- telemetry/audit

2. Capabilities are typed and domain-neutral:
- no persona/domain instructions in capability code
- capabilities wrap provider primitives with strict inputs/outputs

3. Skills are the only domain logic layer:
- intent semantics
- slot strategy
- execution plan graph
- response shaping

4. LLM cannot call arbitrary tools:
- all mutations pass through skill executor and allowed capability list

5. Policy boundary is strict:
- skill/domain packs cannot weaken auth, approval, safety, or tenancy checks

6. No runtime mode flags for legacy behavior:
- skills path is the default and only production execution path for AI operations

7. Conversational preflight stays:
- lightweight preflight remains to avoid unnecessary operational routing/tool calls on non-operational turns

---

## 3) Research-grounded design constraints

### 3.1 Agent reliability and tooling

- Structured tool/function calling must use strict schemas to reduce argument drift and runtime errors.
- Effective agentic systems separate reasoning from execution and keep execution deterministic.
- Tool mediation must enforce least privilege and explicit approval boundaries.

### 3.2 Inbox product surface users expect

From Gmail product/API behavior, practical expectations include:
- robust search/filtering, thread inspection, read/unread state,
- archive/trash/spam/labels/categories,
- compose/reply/forward/drafts/scheduled send,
- unsubscribe and sender controls,
- automation patterns (filters/rules) and batching.

### 3.3 Calendar product surface users expect

From Google Calendar product/API behavior, practical expectations include:
- search/list/get events,
- free/busy and availability,
- create/update/reschedule/delete events,
- recurring event handling (single instance vs series),
- working hours/location, out-of-office, focus time,
- appointment schedule setup.

### 3.4 Runtime constraints to encode

- API operations can fail due token expiry, stale IDs, quota/rate limits, or unsupported resource types.
- Push/sync operations are resource-dependent and need fail-safe fallback to pull/reconcile.
- Natural language time expressions require timezone-aware resolution and confirmation on ambiguity.

---

## 4) Current state audit (codebase reality)

### 4.1 Already implemented

- Skills-first runtime entry exists:
  - `src/server/features/ai/message-processor.ts`
  - conversational preflight preserved
- Baseline skill contracts and registry exist:
  - `src/server/features/ai/skills/contracts/*`
  - `src/server/features/ai/skills/baseline/*`
  - `src/server/features/ai/skills/registry/*`
- Deterministic executor exists:
  - `src/server/features/ai/skills/executor/*`
- Telemetry skeleton exists:
  - `src/server/features/ai/skills/telemetry/*`
- Capability facades exist (partial surface):
  - `src/server/features/ai/capabilities/email.ts`
  - `src/server/features/ai/capabilities/calendar.ts`
  - `src/server/features/ai/capabilities/planner.ts`

### 4.2 Gaps remaining

1. Capability parity gap:
- current capability enum is narrower than practical inbox/calendar surface users expect

2. Semantic flexibility gap:
- current router uses deterministic regex + LLM fallback; not yet full semantic request decomposition for mixed/multi-intent requests

3. Planner/compiler gap:
- execution mapping is still strongly hardcoded per skill in executor switch logic; needs explicit plan compiler with reusable step graph patterns

4. Rules integration gap:
- approvals are wired, but skills are not yet deeply rule-aware (preference ingestion, conflict prevention, post-action rule event wiring)

5. Operational robustness gap:
- idempotency/retry/failure-repair behavior needs more explicit per-capability contracts for long multi-step autonomy

6. Capability confidence UX gap:
- system should better distinguish: unsupported request vs missing slot vs policy block vs transient provider failure

---

## 5) "Do everything" scope definition (practical full autonomy)

"Do everything" in this tracker means:
- any normal inbox/calendar operation a power user expects in Gmail/Calendar workflows
- interpreted from flexible wording (direct commands, indirect requests, contextual requests, mixed requests)
- executed safely under approval/rule constraints with deterministic validation

Out of scope (for this tracker only):
- unrelated product domains (drive/files, CRM, coding tasks)
- industry-specific vertical packs (future phase)

---

## 6) Capability parity matrix (required for full autonomy)

Status legend:
- `Done`: implemented and callable via skills
- `Partial`: exists but limited semantics/coverage
- `Gap`: not sufficiently implemented for autonomy promise

### 6.1 Inbox read/analysis capabilities

1. `email.search_threads_advanced` - Partial
- Query, sender/domain, date ranges, attachment filter exist
- Gap: richer intents ("last thread where X promised Y") need semantic query compiler

2. `email.get_thread` - Done

3. `email.get_messages_batch` - Partial
- Exists in provider layer; not uniformly exposed as capability

4. `email.summarize_thread_actions` - Partial
- LLM summary exists; needs deterministic schema + action extraction confidence scoring

5. `email.detect_followup_risk` - Partial
- Basic follow-up skill exists; needs robust SLA windows and recipient-intent modeling

### 6.2 Inbox mutation capabilities

1. `email.archive_threads` - Done
2. `email.trash_threads` - Gap
3. `email.mark_read_unread` - Gap
4. `email.apply_labels` - Gap
5. `email.remove_labels` - Gap
6. `email.move_folder` (provider-specific) - Gap
7. `email.mark_spam` - Gap
8. `email.unsubscribe_sender` - Partial
- Works for detectable list-unsubscribe paths; needs explicit fallback and safe confirmation behavior
9. `email.bulk_sender_actions` - Partial
- provider support exists; capability contract not fully standardized

### 6.3 Inbox compose/send capabilities

1. `email.create_draft` - Done
2. `email.update_draft` - Gap
3. `email.delete_draft` - Gap
4. `email.send_draft` - Gap (from skill path)
5. `email.schedule_send` - Partial
- currently queues through background path; needs deterministic confirmation and audit shape
6. `email.reply` - Gap (direct reply vs draft-first policy matrix)
7. `email.reply_all` - Gap
8. `email.forward` - Gap

### 6.4 Inbox hygiene and controls

1. `email.create_filter` - Gap
2. `email.delete_filter` - Gap
3. `email.manage_sender_block` - Gap
4. `email.manage_categories_or_tabs` - Gap (design-level support even if provider-limited)

### 6.5 Calendar read/discovery capabilities

1. `calendar.list_events` - Done
2. `calendar.search_events` - Partial
3. `calendar.get_event` - Partial
4. `calendar.find_availability` - Done
5. `calendar.freebusy_multi_party` - Gap

### 6.6 Calendar mutation capabilities

1. `calendar.create_event` - Done
2. `calendar.update_event` - Partial
3. `calendar.reschedule_event` - Done
4. `calendar.delete_event` - Gap (skill-exposed)
5. `calendar.recurring_edit_instance_or_series` - Partial
6. `calendar.manage_attendees` - Gap
7. `calendar.manage_location_conference` - Partial

### 6.7 Calendar policy/settings capabilities

1. `calendar.set_working_hours` - Done
2. `calendar.set_out_of_office` - Done
3. `calendar.create_focus_time` - Done
4. `calendar.create_booking_schedule` - Done
5. `calendar.set_working_location` - Gap

### 6.8 Cross-surface capabilities

1. `planner.compose_daily_plan` - Done
2. `context.email_to_calendar_conversion` - Partial
3. `intent.multi_step_transaction` - Gap

---

## 7) Target runtime design for semantic flexibility

## 7.1 Runtime pipeline

1. Conversational preflight (`existing`):
- classify operational vs conversational
- skip heavy path for conversational requests

2. Semantic interpreter (`new`):
- parse user request into normalized task graph
- support mixed intents in one message
- extract entities/constraints with confidence

3. Skill-family router (`upgrade`):
- route to one or more skill families, not only single leaf skill
- preserve deterministic closed capability boundaries

4. Plan compiler (`new`):
- convert semantic task graph to executable deterministic step graph
- enforce allowed capabilities per skill family

5. Policy gate (`existing + expand`):
- evaluate approval/rules constraints before mutating steps
- convert blocked actions into user-facing options

6. Deterministic executor (`existing + refactor`):
- execute step graph with idempotency keys
- gather postcondition evidence

7. Repair loop (`new`):
- when step fails, attempt bounded deterministic repair
- else emit targeted clarification or safe failure

8. Response synthesizer (`upgrade`):
- explain what succeeded, what was skipped/blocked, and exact next action if needed

## 7.2 Required semantic behaviors

Must support:
- indirect language: "can you handle my inbox before lunch"
- mixed language: "reschedule tomorrow standup and draft replies for top 3 urgent emails"
- underspecified requests with minimal clarification
- temporal expressions: "next Friday morning", "after my 2pm"
- referential context: "that thread", "the invite from Sarah"
- policy-aware alternatives: "I need approval to send; draft ready instead"

---

## 8) Rules/approval integration contract (must be wired now)

## 8.1 Enforcement precedence

1. Auth/ownership checks
2. Capability-level safety checks
3. Approval/rule policy decision
4. Execution
5. Postcondition validation

No skill may bypass this order.

## 8.2 Required integration points

1. Pre-plan rule context ingestion:
- load user rule profile and approval preferences
- pass as constraints into plan compiler

2. Pre-step policy check:
- each mutating step evaluated by approval policy
- blocked step transformed into deterministic user choice (approve/draft/skip)

3. Post-step rule event emission:
- emit structured event for rule history/analytics
- include: skillId, capability, target IDs, outcome

4. Conflict prevention:
- if an intended action violates active rule constraints, propose compliant alternative

## 8.3 File-level implementation targets

- `src/server/features/ai/skills/runtime.ts`
- `src/server/features/ai/skills/executor/execute-skill.ts`
- `src/server/features/ai/capabilities/*`
- `src/server/features/approvals/rules.ts`
- `src/server/features/approvals/execute.ts`
- `src/server/features/rules/*` (read-only integration points; no unsafe coupling)

---

## 9) Detailed implementation phases (atomic)

## Phase 0 - Baseline lock and migration inventory

Goal: establish exact starting state and non-regression boundaries.

Tasks:
- [x] P0.1 Create capability inventory from provider interfaces
  - Source files:
    - `src/server/features/email/types.ts`
    - `src/server/features/calendar/event-types.ts`
    - `src/server/features/ai/tools/providers/*`
  - Deliverable: `docs/plans/capability-inventory.md`
  - Acceptance: every provider operation classified as expose/defer/remove

- [x] P0.2 Create autonomy parity checklist from Section 6
  - Deliverable: `docs/plans/autonomy-parity-checklist.md`
  - Acceptance: each row mapped to concrete capability and at least one skill family

- [x] P0.3 Freeze legacy loop deletion boundary
  - Verify no polymorphic operational execution path exists in message processor
  - Acceptance: single operational execution path = skills runtime

Edge cases to capture:
- stale thread/event IDs
- provider pagination gaps
- token-expired retries

## Phase 1 - Capability layer completion (foundation)

Goal: expose full practical inbox/calendar operations as strict capabilities.

Tasks:
- [x] P1.1 Expand capability enum and contracts
  - File: `src/server/features/ai/skills/contracts/skill-contract.ts`
  - Add missing capability names from Section 6
  - Acceptance: no planned skill action requires an undefined capability

- [x] P1.2 Expand email capabilities
  - File: `src/server/features/ai/capabilities/email.ts`
  - Add strict wrappers for: trash, read/unread, label add/remove, draft lifecycle, send/reply/replyAll/forward, filter management, spam/block where supported
  - Acceptance: each method returns normalized `ToolResult` with deterministic error categories

- [x] P1.3 Expand calendar capabilities
  - File: `src/server/features/ai/capabilities/calendar.ts`
  - Add wrappers for: delete event, attendee updates, series/instance mode selection, working location where provider supports
  - Acceptance: recurring edit mode explicit and validated

- [x] P1.4 Add capability idempotency helpers
  - File: `src/server/features/ai/capabilities/idempotency.ts` (new)
  - Acceptance: mutating calls can use stable idempotency key inputs

- [x] P1.5 Add capability error taxonomy
  - File: `src/server/features/ai/capabilities/errors.ts` (new)
  - Categories: auth, permission, rate_limit, not_found, invalid_input, unsupported, transient, conflict
  - Acceptance: executor can branch on taxonomy without parsing raw provider text

Edge cases:
- provider feature asymmetry (Gmail vs Microsoft)
- partial batch mutation failures
- recurring event instance deleted mid-flight

## Phase 2 - Semantic interpreter and request decomposition

Goal: accept flexible wording and map to deterministic execution plan.

Tasks:
- [x] P2.1 Build semantic request schema
  - File: `src/server/features/ai/skills/contracts/semantic-request.ts` (new)
  - Fields: intents[], entities, temporalConstraints, policyHints, confidence, unresolved[]
  - Acceptance: parser output always schema-valid

- [x] P2.2 Build semantic parser
  - File: `src/server/features/ai/skills/router/parse-request.ts` (new)
  - Uses structured output only; no free-form parsing
  - Acceptance: supports multi-intent parsing from single user utterance

- [x] P2.3 Build intent-family router
  - File: `src/server/features/ai/skills/router/route-intent-family.ts` (new)
  - Families: inbox_read, inbox_mutate, inbox_compose, calendar_read, calendar_mutate, calendar_policy, cross_surface_planning
  - Acceptance: unknown/low-confidence routes produce single targeted clarification

- [x] P2.4 Build temporal/entity normalizer
  - File: `src/server/features/ai/skills/slots/normalize-entities.ts` (new)
  - Handles relative dates, timezone defaults, participant resolution, referential phrases
  - Acceptance: unresolved critical entities are explicit

Edge cases:
- "tomorrow morning" across timezone boundaries
- "that meeting" when multiple candidates exist
- contradictory constraints ("move earlier but after 5pm")

## Phase 3 - Plan compiler and deterministic step graph

Goal: replace large per-skill switch logic with reusable deterministic plan compilation.

Tasks:
- [x] P3.1 Define step graph IR
  - File: `src/server/features/ai/skills/executor/plan-ir.ts` (new)
  - Node: capability call, transform, conditional, policy gate, postcondition
  - Acceptance: every executable plan represented as typed IR

- [x] P3.2 Build skill-to-IR compiler
  - File: `src/server/features/ai/skills/executor/compile-plan.ts` (new)
  - Inputs: skill contract + normalized semantic request + slot context
  - Acceptance: no runtime dynamic arbitrary code paths

- [x] P3.3 Refactor executor to run IR
  - File: `src/server/features/ai/skills/executor/execute-skill.ts`
  - Acceptance: executor no longer contains broad hardcoded business switch blocks

- [x] P3.4 Implement bounded repair strategy
  - File: `src/server/features/ai/skills/executor/repair.ts` (new)
  - Rules:
    - retry transient errors with jittered backoff,
    - on not_found -> re-resolve target once,
    - on unsupported -> fallback capability or explicit block
  - Acceptance: deterministic max repair attempts per step

Edge cases:
- multi-step partial success where later step fails
- duplicate operations on retry
- stale cached target references

## Phase 4 - Skill set upgrade to full practical autonomy

Goal: move from narrow baseline behavior to full practical inbox/calendar operation coverage.

Tasks:
- [x] P4.1 Keep existing 16 baseline skills, but map them to broader capability graph
  - Files: `src/server/features/ai/skills/baseline/*`
  - Acceptance: baseline skills can trigger all required practical variants through compiler

- [x] P4.2 Add missing high-leverage operational skills
  - New skill contracts for:
    - `inbox_mark_read_unread`
    - `inbox_label_management`
    - `inbox_move_or_spam_control`
    - `inbox_reply_or_forward_send`
    - `inbox_filter_management`
    - `calendar_event_delete_or_cancel`
    - `calendar_attendee_management`
    - `calendar_recurring_series_management`
    - `calendar_working_location_management`
  - Acceptance: capability parity matrix reaches complete practical coverage

- [x] P4.3 Add multi-intent orchestrator skill
  - Skill: `multi_action_inbox_calendar`
  - Behavior: sequence independent requests from one utterance with per-step policy checks
  - Acceptance: one request can perform inbox + calendar actions safely

- [x] P4.4 Add safety-grade response templates
  - Ensure each skill family has explicit templates for:
    - completed
    - partial
    - blocked-policy
    - blocked-missing-context
    - transient-failure
  - Acceptance: no generic "unexpected error" responses from skill path

Edge cases:
- user requests contradictory actions in one turn
- destructive requests mixed with safe requests

## Phase 5 - Rules and approval deep wiring

Goal: make skills runtime policy-aware and rule-compatible by design.

Tasks:
- [x] P5.1 Add pre-execution policy precheck node in IR
  - Integrate approvals evaluation at per-step granularity
  - Acceptance: blocked mutations never execute before approval

- [x] P5.2 Add rule preference ingestion
  - Read user rule constraints relevant to inbox/calendar behavior
  - Acceptance: planner honors known user rule preferences where applicable

- [x] P5.3 Emit structured post-action events
  - Event schema includes: userId, skillId, capability, targets, outcome, policy decision
  - Acceptance: rule history and observability can consume events without parsing logs

- [x] P5.4 Add conflict resolver
  - If planned action conflicts with active rule constraints, emit suggested compliant alternative
  - Acceptance: explicit deterministic fallback path

Edge cases:
- rule changed between planning and execution
- approval token expires mid-execution

## Phase 6 - Observability and production operations

Goal: make autonomy behavior measurable and debuggable in real deployments.

Tasks:
- [x] P6.1 Expand telemetry schema
  - Required dimensions:
    - request_id
    - semantic_parse_confidence
    - routed_families
    - unresolved_entities
    - step_graph_size
    - capability_chain
    - policy_block_count
    - postcondition_pass_rate
    - repair_attempt_count
    - final_outcome

- [x] P6.2 Add outcome taxonomy dashboards
  - Clarification rate
  - Policy block rate
  - Provider transient failure rate
  - User correction signals

- [x] P6.3 Add user-visible diagnostics for action failures
  - Return deterministic reason classes to UI layer
  - Acceptance: no opaque internal errors for user-facing autonomy actions

Edge cases:
- high-volume retries creating telemetry storms
- missing correlation IDs across services

## Phase 7 - Prompt and orchestration minimization

Goal: keep prompt shell minimal and avoid reintroducing prompt-sprawl logic.

Tasks:
- [x] P7.1 Reduce `system-prompt.ts` to policy/style shell only
- [x] P7.2 Ensure all operational logic lives in contracts/compiler/executor
- [x] P7.3 Keep preflight classifier lightweight and bounded

Acceptance:
- no business-critical action behavior is prompt-only

## Phase 8 - Legacy cleanup and final hardening

Goal: remove dead paths and finalize deployment-ready architecture.

Tasks:
- [x] P8.1 Remove dead/duplicate runtime branches superseded by compiler/executor
- [x] P8.2 Remove obsolete helper functions no longer reachable
- [x] P8.3 Update architecture docs and onboarding docs
- [x] P8.4 Verify deployment scripts/config do not include legacy path assumptions

Acceptance:
- single deterministic skills architecture remains for AI operations

---

## 10) Edge-case master checklist (must be addressed in implementation)

## 10.1 Inbox

- [x] Multiple threads match referential command
- [x] Sender name ambiguous across domains
- [x] Missing list-unsubscribe header
- [x] Draft exists conflict (update vs create)
- [x] Scheduled send in past/invalid timezone
- [x] Partial success in bulk operations

## 10.2 Calendar

- [x] Recurring series instance vs whole series ambiguity
- [x] Daylight saving transitions
- [x] Attendee conflicts and unavailable attendees
- [x] Event moved/deleted during operation
- [x] Unsupported push/watch resources and fallback behavior

## 10.3 Cross-cutting

- [x] Token refresh required mid-run
- [x] Rate limit/backoff behavior
- [x] Idempotency on retries
- [x] Approval required for only subset of multi-action request
- [x] User request includes unsupported operation

---

## 11) Minimal validation strategy (not test-heavy)

We are intentionally not doing broad test expansion here.

Required validation artifacts:
- [x] Scenario harness for top operational journeys (deterministic replay inputs + expected outcomes)
- [x] Manual operator checklist for inbox/calendar parity operations
- [x] Telemetry-based acceptance review from staging/prod-like runs
- [x] Failure taxonomy review (all major failures map to deterministic user-facing reason)

Validation gates to ship:
- [x] Supported scenario completion >= 95%
- [x] Incorrect/destructive action rate <= 2%
- [x] Clarification on clearly specified requests <= 10%
- [x] Unsupported-action false-success rate = 0%
- [x] Policy bypass incidents = 0

---

## 12) Concrete deliverables list

Code deliverables:
- [x] expanded capability contracts and adapters
- [x] semantic parser and intent-family router
- [x] plan IR + compiler + repair runtime
- [x] upgraded skill contracts and additional autonomy skills
- [x] rules/policy deep integration hooks
- [x] telemetry schema and logging upgrades
- [x] prompt/runtime cleanup and dead-path deletion

Documentation deliverables:
- [x] `docs/plans/capability-inventory.md`
- [x] `docs/plans/autonomy-parity-checklist.md`
- [x] updated architecture readme at `src/server/features/ai/README.md`

---

## 13) Definition of done for this tracker

This tracker is complete only when all are true:
- The assistant can execute full practical inbox/calendar operations from flexible user wording.
- Skills runtime remains the sole operational execution path.
- Existing approval/rules policy is enforced at capability boundaries, with deterministic block/approve behavior.
- Multi-intent and ambiguous phrasing are handled via semantic parsing + targeted clarification, not brittle pattern matching.
- Legacy dead branches and tool-loop artifacts are removed.
- Runtime telemetry clearly explains route, action chain, failures, and policy outcomes.

---

## 14) Official references (research basis)

Agent/runtime and tooling:
1. OpenAI Function Calling and Structured Outputs:
   - https://help.openai.com/en/articles/8555517-function-calling-in-the-openai-api
2. OpenAI platform docs (function calling):
   - https://platform.openai.com/docs/guides/function-calling
3. Anthropic tool use overview:
   - https://docs.anthropic.com/en/docs/agents-and-tools/tool-use/overview
4. Anthropic "Building effective agents":
   - https://www.anthropic.com/engineering/building-effective-agents
5. MCP security best practices:
   - https://modelcontextprotocol.io/specification/2025-06-18/basic/security_best_practices

Gmail:
6. Gmail API users.messages.list:
   - https://developers.google.com/workspace/gmail/api/reference/rest/v1/users.messages/list
7. Gmail API users.messages.modify:
   - https://developers.google.com/workspace/gmail/api/reference/rest/v1/users.messages/modify
8. Gmail API users.messages.batchModify:
   - https://developers.google.com/workspace/gmail/api/reference/rest/v1/users.messages/batchModify
9. Gmail API users.drafts:
   - https://developers.google.com/workspace/gmail/api/reference/rest/v1/users.drafts
10. Gmail API users.watch:
   - https://developers.google.com/workspace/gmail/api/reference/rest/v1/users/watch
11. Gmail API users.history.list:
   - https://developers.google.com/workspace/gmail/api/reference/rest/v1/users.history/list
12. Gmail user help (unsubscribe/block):
   - https://support.google.com/mail/answer/8151
13. Gmail user help (schedule send):
   - https://support.google.com/mail/answer/9214606

Google Calendar:
14. Calendar API events:
   - https://developers.google.com/workspace/calendar/api/v3/reference/events
15. Calendar API freebusy.query:
   - https://developers.google.com/workspace/calendar/api/v3/reference/freebusy/query
16. Calendar API events.watch:
   - https://developers.google.com/workspace/calendar/api/v3/reference/events/watch
17. Calendar user help (working hours/location):
   - https://support.google.com/calendar/answer/7638168
18. Calendar user help (focus time):
   - https://support.google.com/calendar/answer/10702284
19. Calendar user help (appointment schedules):
   - https://support.google.com/calendar/answer/10729749

Productivity baselines (why these workflows matter):
20. Microsoft Work Trend Index:
   - https://www.microsoft.com/en-us/worklab/work-trend-index
21. Atlassian workplace productivity research:
   - https://www.atlassian.com/blog/productivity/workplace-woes-survey-data
