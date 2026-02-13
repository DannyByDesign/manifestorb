# AI Skills Refactor Source of Truth (Production)

Status: Approved architecture reference  
Audience: Engineering (backend, product, infra)  
Scope: Main app AI runtime (web + sidecar mediated flows)  
Last updated: 2026-02-12

---

## 1) Objective

Replace the current prompt-heavy, broad-tool agent runtime with a production-grade skills system that is:

1. Domain-agnostic at the core runtime layer.
2. Deterministic at execution boundaries.
3. Strictly policy-enforced for safety and approvals.
4. Extensible via domain packs without modifying core behavior.
5. Observable with skill-level telemetry and rollout controls.

This document is the single implementation reference for the refactor.

---

## 2) Non-Negotiable Architecture Boundaries

### 2.1 Core Engine Boundary (Hard)

Core engine owns:

- routing and confidence gating
- slot extraction and slot completeness checks
- execution state machine
- idempotency/retry strategy
- approval + safety policy enforcement
- auditing and telemetry emission

Domain packs cannot modify this layer.

### 2.2 Capability Boundary (Hard)

Capabilities are typed, domain-neutral primitives only.

Examples:

- `email.searchThreads`
- `email.modifyThreads`
- `email.createDraft`
- `calendar.findAvailability`
- `calendar.createEvent`
- `calendar.rescheduleEvent`

No vertical semantics in capability implementations.

### 2.3 Skill Layer Boundary (Hard)

All intent-to-action mapping lives in skills:

- baseline universal skills
- optional domain pack overrides/extensions

No direct ad-hoc prompt instruction should define operational behavior outside a skill contract.

### 2.4 Policy Boundary (Hard)

Domain packs cannot weaken:

- auth and ownership checks
- approval requirements
- destructive-action safeguards
- rate limits
- data boundaries

### 2.5 Execution Boundary (Hard)

Production flow must never allow unconstrained LLM tool calling.

All tool/capability calls must pass through Skill Executor with:

- `allowed_tools` enforcement
- slot guardrails
- postcondition validation
- structured failure handling

### 2.6 Evaluation Boundary (Hard)

No new skill can be merged or deployed unless it passes the eval gates in this document.

---

## 3) External Best-Practice Inputs (Research Grounding)

This plan is aligned to current official guidance:

1. Anthropic tool-use guidance: define clear tool schemas and use structured outputs for reliable orchestration.
2. Anthropic Claude Code skills guidance: task-specific, explicit instructions improve reliability and composability.
3. OpenAI structured function calling guidance: strict schema conformance (`strict: true`) for deterministic argument contracts.
4. MCP security guidance: least privilege, explicit user control/consent, and safe tool mediation.
5. Google Workspace docs: Gmail and Calendar expose concrete primitives suitable for deterministic skills (filters, labels/categories, schedule send, working hours/location, focus time, appointment schedules).
6. Productivity signal sources (Microsoft Work Trend Index, Atlassian workplace research): overload and meeting fragmentation are high-frequency universal pain points, supporting the selected baseline skills.

See References section for links.

---

## 4) Audit Against Current Codebase (Reality Check)

## 4.1 What Exists Today

### A) LLM-first orchestration with broad mode classification

- File: `src/server/features/ai/orchestration/preflight.ts`
- Current behavior:
  - fast-path heuristics + LLM `generateObject` classification into `chat|thought_partner|lookup|action`
  - decides `needsTools`, `contextTier`, `needsInternalData`
- Gap:
  - not a closed-set skill router
  - not tied to explicit skill contracts

### B) Dynamic broad tool registry

- File: `src/server/features/ai/tools/index.ts`
- Current behavior:
  - mounts polymorphic tools: `query/get/create/modify/delete/analyze/triage/rules/send/workflow/webSearch`
- Gap:
  - no per-skill `allowed_tools` boundary
  - tools are broad multi-resource interfaces

### C) Prompt-centric operational logic

- File: `src/server/features/ai/system-prompt.ts`
- Current behavior:
  - large behavioral policy and operational instructions in one prompt
- Gap:
  - operational invariants are prompt text, not executable contracts
  - high risk of drift and non-deterministic action mapping

### D) No explicit skills runtime module

- Files scanned under `src/server/features/ai/**`
- Finding:
  - no `skills/` runtime with registry/router/executor/contract modules
  - (historical) runtime gating relied on ad-hoc prompts and broad tools rather than a contract-driven skill runtime

### E) Existing tool safety is useful but insufficient for skills architecture

- Files: `src/server/features/ai/tools/executor.ts`, `src/server/features/ai/tools/security.ts`
- Current strengths:
  - zod validation
  - resource ownership checks
  - rate limiting and audit log
- Gap:
  - safety exists at tool layer, not skill-plan layer
  - no postcondition checks tied to intended user outcome

## 4.2 Audit of Your Original Checklist

Result: the core platform is now implemented in `src/server/features/ai/skills/**`.

- `SkillContract schema`: implemented (`skills/contracts/skill-contract.ts`)
- `Skill Router (closed-set baseline)`: implemented (`skills/router/*`)
- `Skill Executor + postconditions`: implemented (`skills/executor/*`)
- `Tool Facades (Capabilities)`: implemented (`src/server/features/ai/capabilities/*`)
- `Skill telemetry`: implemented (`skills/telemetry/*`)
- `16 baseline skills`: implemented as contracts; execution coverage is in progress (`skills/baseline/*`)
- `Legacy agent loop removed`: implemented (skills-only message processor)

---

## 5) Target Architecture (Final)

## 5.1 Runtime Topology

1. User request enters message processor.
2. Skill Router selects one baseline skill (closed set) or asks one clarification.
3. Slot Resolver validates required slots.
4. Skill Executor runs deterministic plan steps.
5. Each step invokes only allowed typed capabilities.
6. Postconditions are validated.
7. Structured response template renders final user reply.
8. Telemetry and audit events are emitted.

## 5.2 New Module Layout

Add:

`src/server/features/ai/skills/contracts/`
- `skill-contract.ts` (zod schema + types)
- `slot-types.ts`

`src/server/features/ai/skills/registry/`
- `baseline-registry.ts`
- `domain-pack-registry.ts` (empty now, interface only)

`src/server/features/ai/skills/router/`
- `route-skill.ts` (closed-set router)
- `router-prompts.ts` (minimal)

`src/server/features/ai/skills/slots/`
- `resolve-slots.ts`
- `slot-clarifications.ts`

`src/server/features/ai/skills/executor/`
- `execute-skill.ts`
- `step-runner.ts`
- `postconditions.ts`
- `failure-normalizer.ts`

`src/server/features/ai/skills/telemetry/`
- `events.ts`
- `emit.ts`

`src/server/features/ai/skills/baseline/`
- one file per baseline skill contract (16 files)

`src/server/features/ai/capabilities/`
- `email.ts`
- `calendar.ts`
- `planner.ts`
- `index.ts`

Update:

- `src/server/features/ai/message-processor.ts` (add skills path + flags)
- `src/server/features/ai/system-prompt.ts` (reduce to policy/style shell)
- `src/env.ts` (add skills flags)

---

## 6) Skill Contract (Canonical)

Every skill must implement:

- `id`
- `intent_examples[]`
- `required_slots[]`
- `optional_slots[]`
- `allowed_tools[]`
- `plan[]`
- `success_checks[]`
- `failure_modes[]`
- `user_response_templates`

Additional required operational metadata:

- `risk_level`: `safe|caution|dangerous`
- `requires_approval`: boolean
- `idempotency_scope`: `message|thread|conversation`
- `supports_dry_run`: boolean
- `owner`: string
- `version`: semver

---

## 7) Baseline Skills (Phase 1 Universal Set)

These 16 remain the baseline set before domain packs:

1. `inbox_triage_today`
2. `inbox_bulk_newsletter_cleanup`
3. `inbox_subscription_control`
4. `inbox_snooze_or_defer`
5. `inbox_thread_summarize_actions`
6. `inbox_draft_reply`
7. `inbox_schedule_send`
8. `inbox_followup_guard`
9. `calendar_find_availability`
10. `calendar_schedule_from_context`
11. `calendar_reschedule_with_constraints`
12. `calendar_focus_time_defense`
13. `calendar_working_hours_ooo`
14. `calendar_booking_page_setup`
15. `calendar_meeting_load_rebalance`
16. `daily_plan_inbox_calendar`

## 7.1 Baseline Skill Data Requirements (per skill file)

Each skill file must include:

- canonical slot schema
- allowed capabilities
- deterministic plan steps
- explicit postconditions
- approval behavior
- failure recovery prompts
- examples of user phrasing

## 7.2 Capability Mapping Rules

Skills can use only capability facades, not raw providers.

Examples:

- Inbox cleanup skills:
  - `email.searchThreads`
  - `email.batchArchive`
  - `email.unsubscribeSender`
- Calendar scheduling skills:
  - `calendar.findAvailability`
  - `calendar.createEvent`
  - `calendar.updateEvent`
- Daily planning:
  - `email.searchThreads`
  - `calendar.listUpcoming`
  - `planner.composeDayPlan`

---

## 8) Explicit Non-Baseline Scope (Lean Constraint)

Not in baseline:

- industry compliance/policy workflows
- vertical terminology heuristics
- low-frequency high-risk autonomous automation bundles
- cross-surface orchestration beyond inbox/calendar core

---

## 9) Rollout and Operations Plan

This repo is **skills-only**: the skills runtime is always used. There are **no**
runtime feature flags for enabling/disabling the skills path.

Operational control is achieved via:

- normal deployments (git + Railway)
- strict runtime boundaries (allowed tools, postconditions, idempotency)
- telemetry + logs for debugging and regression detection

## 9.1 Success Gates (Production)

Must meet:

- task success rate on top 25 baseline scenarios: `>=95%`
- incorrect tool/action rate: `<=2%`
- clarification on clearly-specified requests: `<=10%`
- user-corrected action within 10 minutes: `<=5%`
- unsupported-failure rate on baseline intents: `<=3%`
- safety violations: `0`

---

## 10) Phase-by-Phase Execution Blueprint (Granular)

Note: Tests are intentionally deprioritized for this pass. Focus is architecture correctness, deterministic runtime boundaries, telemetry, and rollout controls. Add minimal smoke checks only where required to prevent blind deploys.

## Phase 0: Platform Preparation and Guardrails

Goals:

- define contracts and repo structure
- freeze boundary decisions

Tasks:

1. Create `src/server/features/ai/skills/**` module skeleton.
2. Create contract schema in `skills/contracts/skill-contract.ts`.
3. Add architecture ADR doc (optional) under `docs/architecture/`.
5. Update `src/server/features/ai/README.md` to point to this plan doc.

Exit criteria:

- Skills modules compile.
- Orchestration preflight is active (conversational turns skip the skills runtime).

## Phase 1A: Skill Platform Foundation

Goals:

- closed-set routing
- deterministic execution
- capability mediation

Tasks:

1. Implement registry:
   - `skills/registry/baseline-registry.ts`
2. Implement router:
   - `skills/router/route-skill.ts`
   - confidence threshold + single targeted clarification
3. Implement slot resolver:
   - `skills/slots/resolve-slots.ts`
4. Implement executor:
   - `skills/executor/execute-skill.ts`
   - step runner + postcondition validator
5. Implement capabilities:
   - `ai/capabilities/email.ts`
   - `ai/capabilities/calendar.ts`
6. Add telemetry events:
   - route confidence
   - missing slot reasons
   - tool chain
   - postcondition pass/fail
   - user correction event hooks

Exit criteria:

- No direct raw tool invocation from skill path.
- Executor rejects out-of-contract operations.

## Phase 1B: Baseline Skills Implementation (v1)

Goals:

- implement 16 baseline skill contracts
- remove operational behavior from prompt text

Tasks:

1. Add one contract file per baseline skill in `skills/baseline/`.
2. Register all 16 in baseline registry.
3. Build standardized response templates for:
   - success
   - partial completion
   - blocked by missing info
   - blocked by policy
4. Enforce `allowed_tools` in executor.

Exit criteria:

- Each baseline skill has required slots, plan, postconditions, failure modes.
- Router can only emit registered baseline IDs.

## Phase 2: Message Processor Integration

Goals:

- keep a lightweight orchestration preflight (latency/cost guard)
- route all operational turns through the skills runtime (single execution path)

Tasks:

1. Update `src/server/features/ai/message-processor.ts`:
   - run orchestration preflight first
   - if `needsTools=false`, respond conversationally without invoking skills router/slots/executor
   - if `needsTools=true`, run skills router/slots/executor and return that output
2. Ensure approvals still pass through existing approval services (capability/tool layer remains authoritative for approvals).

Exit criteria:

- Conversational turns skip skills runtime.
- Operational turns always execute via skills runtime.

## Phase 3: Prompt Minimization and Legacy Decomposition

Goals:

- collapse prompt sprawl
- move operational logic into skill contracts

Tasks:

1. Reduce `src/server/features/ai/system-prompt.ts` to:
   - global policy
   - tone/style
   - tool safety disclaimers
2. Remove duplicated operational instructions now covered by skills.
3. Keep explicit anti-injection and safety policy text.

Exit criteria:

- prompt no longer encodes core operational workflows.

## Phase 4: Controlled Cutover

Goals:

- Skills runtime serves production for baseline intents (skills-only).

Tasks:

1. Ensure `src/server/features/ai/message-processor.ts` routes all requests through the skills runtime.
2. Ensure there is no legacy agentic tool-loop code path for supported inbox/calendar skills.
3. Ensure failures are fail-closed with user-safe messages (no silent tool calls).

Exit criteria:

- Skills-only path is the only execution path for baseline intents.

## Phase 5: Cleanup and Deletion

Goals:

- remove obsolete code paths
- simplify maintainability long-term

Tasks:

1. Delete dead orchestration branches no longer used.
2. Remove obsolete prompt sections and legacy dispatch logic.
3. Keep only capabilities required by core inbox/calendar mission.
4. Update docs to reflect final architecture.

Exit criteria:

- no dormant legacy runtime path remains for covered baseline intents.

---

## 11) Production Observability Requirements

Required telemetry dimensions:

- `skill_id`
- `route_confidence`
- `missing_slots_count`
- `clarification_issued`
- `execution_steps_count`
- `allowed_tools_violations`
- `postcondition_pass`
- `approval_required`
- `approval_outcome`
- `user_correction_within_10m`
- `final_status` (`success|partial|blocked|failed`)

Dashboards:

1. Skill success/error by skill ID
2. Clarification rate by skill
3. Postcondition failure reasons
4. Safety/policy block events

---

## 12) Domain Pack Extension Model (After Baseline Stabilization)

Core remains immutable. Packs can only:

- change prioritization heuristics
- provide style defaults
- add workflow preferences
- add additional skill contracts in allowed extension namespaces

Packs cannot:

- bypass approval policies
- bypass capability constraints
- call undeclared tools
- alter auth/data boundaries

Initial pack roadmap (future):

- `founder_pack`
- `exec_assistant_pack`
- `sales_pack`
- `recruiting_pack`

---

## 13) Implementation Order (Recommended)

1. Phase 0 complete
2. Build 8 highest-frequency baseline skills first:
   - inbox triage, newsletter cleanup, draft reply, schedule send, follow-up guard
   - calendar availability, schedule from context, reschedule with constraints
3. Integrate preflight + skills runtime in message processor
4. Add remaining baseline skills
5. Cleanup and delete legacy path

---

## 14) Deprioritized Tests Policy (This Refactor Only)

For this execution cycle:

- Do not spend cycles on broad unit test expansion.
- Do add only minimal smoke checks for:
  - skill contract parsing
  - router emits valid registered skill
  - executor rejects out-of-contract tool invocation
- Primary quality mechanism is telemetry + targeted eval gates.

After this refactor stabilizes, backfill deeper tests for long-term regression resistance.

---

## 15) Definition of Done

Done means all are true:

1. Baseline skill runtime active in production.
2. Legacy prompt-driven path disabled for covered Gmail/Calendar core intents.
3. Gates achieved (Section 9.4).
4. No boundary violations in policy/execution.
5. Documentation updated and onboarding for domain packs complete.

Completion status:

- Baseline runtime is skills-first and integrated through `message-processor`.
- Legacy assistant polymorphic tool-loop path was removed from live execution.
- Capability facades execute deterministic operations for baseline skills.
- Baseline skill contracts, router, slot resolver, executor, and postconditions are in place.
- Remaining future work is additive (domain packs), not baseline migration debt.

---

## 16) References

1. Anthropic tool use overview: https://docs.anthropic.com/en/docs/agents-and-tools/tool-use/overview
2. Anthropic Claude Code skills: https://docs.anthropic.com/en/docs/claude-code/skills
3. OpenAI function calling and structured outputs: https://help.openai.com/en/articles/8555517-function-calling-in-the-openai-api
4. OpenAI eval design examples: https://cookbook.openai.com/examples/evaluation/use-cases/evalsapi_tools_evaluation
5. MCP security best practices: https://modelcontextprotocol.io/specification/2025-06-18/basic/security_best_practices
6. Google Calendar API events: https://developers.google.com/workspace/calendar/api/v3/reference/events
7. Google Calendar release notes (watch/push constraints context): https://developers.google.com/workspace/calendar/release-notes
8. Gmail labels/categories: https://support.google.com/mail/answer/3094499?hl=en
9. Gmail schedule send: https://support.google.com/mail/answer/9214606?hl=en
10. Gmail block/unsubscribe: https://support.google.com/mail/answer/8151?hl=en
11. Google Calendar focus time: https://support.google.com/calendar/answer/10702284?hl=en
12. Google Calendar working hours/location: https://support.google.com/calendar/answer/7638168?hl=en
13. Google Calendar appointment schedules: https://support.google.com/calendar/answer/10729749?hl=en
14. Microsoft Work Trend Index (meeting/email overload signal): https://www.microsoft.com/en-us/worklab/work-trend-index
15. Atlassian workplace/meeting overload signal: https://www.atlassian.com/blog/productivity/workplace-woes-survey-data

---

## 17) Detailed Execution Work Breakdown (Implementation-Grade)

This section is the operational build plan for multi-hour implementation sessions.

### 17.1 Workstreams

1. Runtime foundation (`skills/contracts`, `skills/registry`, `skills/router`, `skills/executor`)
2. Capability facades (`ai/capabilities/*`)
3. Baseline skills (`skills/baseline/*`)
4. Message processor integration (`message-processor.ts`)
5. Prompt minimization (`system-prompt.ts`)
6. Telemetry + observability (`skills/telemetry/*`)
7. Legacy cleanup (dead-path deletion + docs updates)

### 17.2 Milestone Slices (Ship Order)

M0:
- add new module skeleton
- add contract schema
- no behavioral change

M1:
- router + slot resolver + executor skeleton
- skills runtime wired end-to-end (skills-only), but with minimal skill coverage

M2:
- expand baseline skill coverage + capability coverage
- add telemetry events and structured failure reporting

M3:
- first 8 baseline skills production-ready
- production stability: fewer "not implemented" fallbacks for supported skills

M4:
- all 16 baseline skills
- prompt minimization completed

M5:
- legacy branch deletion pass complete

### 17.3 Artifact Checklist Per Milestone

M0 artifacts:
- `src/server/features/ai/skills/contracts/skill-contract.ts`
- `src/server/features/ai/skills/contracts/slot-types.ts`
- `src/server/features/ai/skills/registry/baseline-registry.ts`

M1 artifacts:
- `src/server/features/ai/skills/router/route-skill.ts`
- `src/server/features/ai/skills/slots/resolve-slots.ts`
- `src/server/features/ai/skills/executor/execute-skill.ts`
- `src/server/features/ai/capabilities/index.ts`

M2 artifacts:
- telemetry schema and emitters
- structured skill execution logging (tool chain, slots, postconditions)

M3 artifacts:
- 8 skill contract files
- allowed-tools/capability enforcement logs
- postcondition evaluator coverage for first 8 skills

M4 artifacts:
- all 16 skill files
- prompt-reduction PR
- docs updates for operators

M5 artifacts:
- deleted legacy blocks
- final migration report

---

## 18) File-Level Change Plan (Granular)

### 18.1 New Files to Add

`src/server/features/ai/skills/contracts/skill-contract.ts`
- export zod schema for canonical SkillContract
- export `type SkillContract`
- export validation helper `parseSkillContract()`

`src/server/features/ai/skills/contracts/slot-types.ts`
- slot primitives: date range, participant list, thread reference, send-window, urgency band
- slot coercion helpers

`src/server/features/ai/skills/registry/baseline-registry.ts`
- map `skillId -> SkillContract`
- export immutable registry
- export lookup helper with explicit error

`src/server/features/ai/skills/router/route-skill.ts`
- closed-set route function
- confidence threshold
- single-clarification prompt when routing confidence is too low

`src/server/features/ai/skills/router/router-prompts.ts`
- compact router instruction template
- no business logic

`src/server/features/ai/skills/slots/resolve-slots.ts`
- extract slots from user message + context pack
- return `resolved`, `missingRequired`, `ambiguous`

`src/server/features/ai/skills/slots/slot-clarifications.ts`
- deterministic clarification question templates

`src/server/features/ai/skills/executor/execute-skill.ts`
- execute deterministic plan steps
- enforce allowed capabilities
- call postcondition validator

`src/server/features/ai/skills/executor/step-runner.ts`
- step primitives: `search`, `transform`, `propose`, `apply`
- step result envelope

`src/server/features/ai/skills/executor/postconditions.ts`
- per-skill postcondition checks
- standardized failure reasons

`src/server/features/ai/skills/executor/failure-normalizer.ts`
- map raw failures to user-safe, operator-rich errors

`src/server/features/ai/skills/telemetry/events.ts`
- typed event schema
- event names and payload contracts

`src/server/features/ai/skills/telemetry/emit.ts`
- telemetry emitters (logger-based in this repo)

`src/server/features/ai/capabilities/email.ts`
- facade wrappers around existing tool/provider behavior

`src/server/features/ai/capabilities/calendar.ts`
- facade wrappers around calendar operations

`src/server/features/ai/capabilities/planner.ts`
- cross-resource read-only plan synthesis helpers

`src/server/features/ai/skills/baseline/*.ts`
- 16 files, one skill contract per file

### 18.2 Existing Files to Update

`src/server/features/ai/message-processor.ts`
- inject skills flow entry point
- run orchestration preflight first so conversational turns skip skills router/slots/executor

`src/server/features/ai/orchestration/preflight.ts`
- keep preflight active as a latency/cost guard for conversational turns

`src/server/features/ai/system-prompt.ts`
- remove operational intent logic
- retain global safety and style policy only

`src/server/features/ai/README.md`
- keep updated links to source-of-truth and current rollout status

### 18.3 Existing Files to Leave Untouched in Early Phases

`src/server/features/ai/tools/*`
- keep stable during M0-M2
- wrap via capabilities instead of rewriting immediately

---

## 19) Runtime Interfaces (Canonical Contracts)

Use these signatures as implementation constraints.

```ts
export type SkillId =
  | "inbox_triage_today"
  | "inbox_bulk_newsletter_cleanup"
  | "inbox_subscription_control"
  | "inbox_snooze_or_defer"
  | "inbox_thread_summarize_actions"
  | "inbox_draft_reply"
  | "inbox_schedule_send"
  | "inbox_followup_guard"
  | "calendar_find_availability"
  | "calendar_schedule_from_context"
  | "calendar_reschedule_with_constraints"
  | "calendar_focus_time_defense"
  | "calendar_working_hours_ooo"
  | "calendar_booking_page_setup"
  | "calendar_meeting_load_rebalance"
  | "daily_plan_inbox_calendar";

export type CapabilityName =
  | "email.searchThreads"
  | "email.batchArchive"
  | "email.unsubscribeSender"
  | "email.snoozeThread"
  | "email.createDraft"
  | "email.scheduleSend"
  | "calendar.findAvailability"
  | "calendar.createEvent"
  | "calendar.rescheduleEvent"
  | "calendar.setWorkingHours"
  | "calendar.setOutOfOffice"
  | "calendar.createFocusBlock"
  | "calendar.createBookingSchedule"
  | "planner.composeDayPlan";

export interface SkillContract {
  id: SkillId;
  intent_examples: string[];
  required_slots: string[];
  optional_slots: string[];
  allowed_tools: CapabilityName[];
  plan: SkillPlanStep[];
  success_checks: SkillSuccessCheck[];
  failure_modes: SkillFailureMode[];
  user_response_templates: SkillResponseTemplates;
  risk_level: "safe" | "caution" | "dangerous";
  requires_approval: boolean;
  idempotency_scope: "message" | "thread" | "conversation";
  supports_dry_run: boolean;
  owner: string;
  version: string;
}

export interface SkillRouteResult {
  skillId: SkillId | null;
  confidence: number;
  reason: string;
  clarificationPrompt?: string;
}

export interface SlotResolutionResult {
  resolved: Record<string, unknown>;
  missingRequired: string[];
  ambiguous: string[];
  clarificationPrompt?: string;
}

export interface SkillExecutionResult {
  status: "success" | "partial" | "blocked" | "failed";
  responseText: string;
  postconditionsPassed: boolean;
  stepsExecuted: number;
  toolChain: CapabilityName[];
  failureReason?: string;
}
```

---

## 20) Router and Slot-Filling Algorithm (Deterministic)

Router algorithm:

1. Build candidate set from baseline registry IDs only.
2. Run structured classification against closed-set IDs.
3. Reject unknown IDs unconditionally.
4. If confidence below threshold (default `0.72`), ask one targeted clarification.
5. If above threshold, proceed to slot resolution.

Slot resolution algorithm:

1. Resolve required slots from message text.
2. Fill from context pack only when deterministic and user-owned.
3. Mark unresolved required slots in `missingRequired`.
4. If any required slot missing, emit one clarification question only.
5. Do not execute skill until required slots complete.

---

## 21) Capability Facade Mapping From Existing Tools

Map existing broad tools to narrow capabilities first, then migrate callers.

`query(resource=email)` -> `email.searchThreads`
`modify(resource=email, action=archive)` -> `email.batchArchive`
`modify(resource=email, action=unsubscribe)` -> `email.unsubscribeSender`
`modify(resource=email, action=snooze)` -> `email.snoozeThread`
`create(resource=email, action=draft)` -> `email.createDraft`
`send(scheduleSend)` -> `email.scheduleSend`
`query(resource=calendar)` -> `calendar.findAvailability`
`create(resource=calendar)` -> `calendar.createEvent`
`modify(resource=calendar)` -> `calendar.rescheduleEvent`
`modify(resource=preferences)` -> `calendar.setWorkingHours`

Constraint:
- no skill may call `query`, `create`, or `modify` directly once facade exists.

---

## 22) Baseline Skill Specifications (Execution Detail)

### 22.1 `inbox_triage_today`

Required slots: `time_window=today`.
Optional slots: `priority_bias`, `sender_focus`.
Allowed tools: `email.searchThreads`.
Plan: search actionable threads for today; score urgency; return top queue with rationale.
Success checks: returns ranked list size >=1 when actionable items exist.
Failure modes: no items found; provider unavailable.
User response: concise ranked items with next action.

### 22.2 `inbox_bulk_newsletter_cleanup`

Required slots: `target_scope`.
Optional slots: `sender_allowlist`, `age_threshold`.
Allowed tools: `email.searchThreads`, `email.batchArchive`.
Plan: identify newsletter/promotions candidates; present dry-run count; apply archive if confirmed/policy allows.
Success checks: applied count equals selected count.
Failure modes: ambiguous candidate set; ownership mismatch.
User response: items archived + rollback guidance.

### 22.3 `inbox_subscription_control`

Required slots: `sender_or_domain`.
Optional slots: `action=unsubscribe|block`.
Allowed tools: `email.searchThreads`, `email.unsubscribeSender`.
Plan: locate subscription sender; execute unsubscribe control.
Success checks: unsubscribe action status success.
Failure modes: no unsubscribe metadata.
User response: status and next step.

### 22.4 `inbox_snooze_or_defer`

Required slots: `thread_ids`, `defer_until`.
Optional slots: `reason`.
Allowed tools: `email.snoozeThread`.
Plan: apply snooze/defer to selected threads.
Success checks: all target threads updated.
Failure modes: invalid time.
User response: deferred items + wake time.

### 22.5 `inbox_thread_summarize_actions`

Required slots: `thread_id`.
Optional slots: `summary_style`.
Allowed tools: `email.searchThreads`.
Plan: fetch thread context; summarize decisions, action items, deadlines.
Success checks: output contains decisions, tasks, deadlines sections.
Failure modes: thread unavailable.
User response: structured summary.

### 22.6 `inbox_draft_reply`

Required slots: `thread_id` or `recipient`, `reply_intent`.
Optional slots: `tone`, `length`.
Allowed tools: `email.createDraft`.
Plan: generate draft content from context; save draft.
Success checks: draft id created.
Failure modes: missing recipient.
User response: draft created with concise preview.

### 22.7 `inbox_schedule_send`

Required slots: `draft_id`, `send_time`.
Optional slots: `timezone`.
Allowed tools: `email.scheduleSend`.
Plan: validate send window; schedule send.
Success checks: provider confirms schedule set.
Failure modes: invalid send window.
User response: scheduled confirmation.

### 22.8 `inbox_followup_guard`

Required slots: `time_window`.
Optional slots: `high_priority_only`.
Allowed tools: `email.searchThreads`.
Plan: find awaiting-reply risks and overdue follow-ups; propose nudge list.
Success checks: returns at-risk set or explicit none-found.
Failure modes: none critical.
User response: follow-up recommendations.

### 22.9 `calendar_find_availability`

Required slots: `participants`, `date_window`, `duration`.
Optional slots: `timezone`.
Allowed tools: `calendar.findAvailability`.
Plan: compute candidate free slots.
Success checks: at least 3 candidate slots when availability exists.
Failure modes: no common free time.
User response: proposed slots.

### 22.10 `calendar_schedule_from_context`

Required slots: `title`, `participants`, `start`, `duration`.
Optional slots: `location`, `agenda`.
Allowed tools: `calendar.createEvent`.
Plan: create event from extracted context.
Success checks: event id returned.
Failure modes: attendee ambiguity.
User response: created event details.

### 22.11 `calendar_reschedule_with_constraints`

Required slots: `event_id`, `reschedule_window`.
Optional slots: `must_keep_attendees`, `must_keep_duration`.
Allowed tools: `calendar.findAvailability`, `calendar.rescheduleEvent`.
Plan: find valid alternative; apply reschedule.
Success checks: event moved and constraints satisfied.
Failure modes: no valid slot.
User response: old vs new schedule.

### 22.12 `calendar_focus_time_defense`

Required slots: `focus_block_window`.
Optional slots: `auto_decline=true|false`.
Allowed tools: `calendar.createFocusBlock`.
Plan: create/update focus blocks.
Success checks: focus blocks persisted.
Failure modes: conflicts with hard events.
User response: protected focus windows.

### 22.13 `calendar_working_hours_ooo`

Required slots: `working_hours` or `ooo_window`.
Optional slots: `location`, `timezone`.
Allowed tools: `calendar.setWorkingHours`, `calendar.setOutOfOffice`.
Plan: apply boundaries.
Success checks: settings updated.
Failure modes: invalid hour ranges.
User response: policy summary.

### 22.14 `calendar_booking_page_setup`

Required slots: `schedule_window`, `slot_duration`.
Optional slots: `buffers`, `daily_cap`.
Allowed tools: `calendar.createBookingSchedule`.
Plan: configure appointment schedule.
Success checks: booking schedule active.
Failure modes: unsupported settings.
User response: booking setup summary.

### 22.15 `calendar_meeting_load_rebalance`

Required slots: `analysis_window`.
Optional slots: `max_meetings_per_day`.
Allowed tools: `calendar.findAvailability`, `calendar.rescheduleEvent`.
Plan: identify movable non-critical meetings; propose compression/rebalance actions.
Success checks: reclaim focus window minutes above threshold.
Failure modes: no movable meetings.
User response: reclaimed time summary.

### 22.16 `daily_plan_inbox_calendar`

Required slots: `planning_day`.
Optional slots: `priority_focus`.
Allowed tools: `email.searchThreads`, `calendar.findAvailability`, `planner.composeDayPlan`.
Plan: synthesize top email tasks + meetings + focus blocks.
Success checks: produces integrated day plan.
Failure modes: missing calendar or inbox context.
User response: ordered daily execution plan.

---

## 23) Prompt Decomposition Map (What Gets Removed)

Move out of `system-prompt.ts` into skills/capabilities:

- per-intent operational instructions
- draft flow procedural logic
- calendar scheduling procedural logic
- rule-based conditional workflows that are now skill plan steps

Keep in `system-prompt.ts`:

- universal safety policy
- anti-injection policy
- communication style/tone
- approval policy summaries

---

## 24) Telemetry Spec (Event-Level)

Event names:

- `skill.route.started`
- `skill.route.completed`
- `skill.slot_resolution.completed`
- `skill.execution.started`
- `skill.step.completed`
- `skill.postcondition.completed`
- `skill.execution.completed`
- `skill.user_correction.observed`

Required fields on all events:

- `request_id`
- `user_id_hash`
- `conversation_id`
- `provider`
- `timestamp`

Execution-completed fields:

- `skill_id`
- `status`
- `route_confidence`
- `steps_executed`
- `allowed_tools_violations`
- `postconditions_passed`
- `approval_required`
- `duration_ms`

---

## 25) Incident Response Runbook (Skills-Only)

This system intentionally has **no runtime mode switches**. If a production regression happens:

1. Identify the failing `skill_id` and `requestId` in logs (and the tool chain + failure reason).
2. Patch the failing skill/capability deterministically (or temporarily fail-closed with a clear user message).
3. Deploy the fix.
4. If immediate mitigation is required and a fix cannot be shipped quickly, revert the last known-bad deploy via git (preferred), rather than adding runtime flags.

---

## 27) Legacy Cleanup Manifest (Deletion Targets)

Deletion targets are executed only after M4 stabilization.

Candidate cleanup areas:

- preflight logic branches no longer used for baseline skills
- prompt sections replaced by skill contracts
- message processor legacy branches removed during migration
- any ad-hoc intent mapping logic duplicated by router

Deletion process:

1. Mark candidate code with `@legacy-skill-migration` comments.
2. Confirm no callsites remain in the repo.
3. Delete in small slices with rollback-safe commits.

---

## 28) Session Context Retention Protocol

For long implementation runs, update this plan at end of each session with:

- current milestone (`M0-M5`)
- completed artifacts
- blocked artifacts
- exact next file to edit

Session log template:

```md
### Session Log - YYYY-MM-DD HH:MM UTC
- Milestone: Mx
- Completed:
- In progress:
- Blockers:
- Next file:
- Notes:
```

---

## 29) Execution Queue Status

The immediate migration queue has been completed for the baseline scope.

Completed items include:

1. skills-only routing in `src/server/features/ai/message-processor.ts`
2. missing baseline capability coverage (including scheduled-send execution endpoint)
3. deterministic executor handling for all baseline capability steps
4. calendar list/availability support for planning skills
5. thread-context retrieval support for inbox summary/reply workflows
6. slot extraction/defaulting hardening to reduce unnecessary clarifications
7. richer executor responses + postcondition validation
8. deterministic mutation behavior and telemetry coverage
9. system prompt minimization to policy/style shell
10. removal of legacy assistant polymorphic tool-loop callsites + doc updates

---

## 30) Build Outcome Clarification

When this full plan is executed end-to-end, the intended outcome is:

1. Production runtime is skill-centric for core inbox/calendar actions.
2. Prompt sprawl is minimized and no longer controls operational behavior.
3. Legacy generic path is disabled for covered intents.
4. Codebase complexity decreases by removing duplicated orchestration logic.
5. Domain-specific packs become additive modules, not core rewrites.

Current status at this moment:

- The baseline migration is complete.
- Skills are the primary and only operational mechanism for assistant turns.
- Legacy assistant tool-loop code paths are removed from live execution.
- Remaining roadmap work is additive domain packs and optimization, not migration cleanup.

---

## 31) Mandatory Task Spec Format (Use For Every Implementation Task)

No task is allowed in execution unless it is written in this format.

### 31.1 Task Spec Fields

Every task must include:

1. `Task ID`  
2. `What we are building` (concrete artifact names + file paths)  
3. `Why this exists` (user/problem impact)  
4. `Inputs` (upstream data/functions/config)  
5. `Outputs` (return shape, persisted effects, emitted events)  
6. `Policy/Safety constraints` (what must never happen)  
7. `Failure modes` (expected and explicit handling)  
8. `Observability` (events, counters, logs)  
9. `Acceptance criteria` (binary done checks)  
10. `References` (online docs/research links)

### 31.2 Quality Bar

A task is incomplete if any of the following are missing:

- clear artifact path
- explicit acceptance criteria
- at least one external reference
- explicit failure behavior

---

## 32) Phase Task Specs (Execution Backlog, Non-Generic)

This section converts the migration plan into concrete engineering tickets.

### 32.1 Phase 0 Task Specs

#### TASK-P0-001: Enforce Skills-Only Runtime (No Flags)

What we are building:
- A single production path where `src/server/features/ai/message-processor.ts` always executes:
  - router -> slot resolver -> executor -> postconditions -> response rendering
- Remove (or do not introduce) any runtime switches for skills enablement.

Why:
- This project’s hard boundary is “skills is the default and the only thing”.
- Debuggability and long-term correctness come from deterministic contracts + telemetry, not branching runtime modes.

Inputs:
- `src/server/features/ai/skills/runtime.ts`
- `src/server/features/ai/skills/router/*`
- `src/server/features/ai/skills/slots/*`
- `src/server/features/ai/skills/executor/*`

Outputs:
- Skills runtime invoked for every assistant request.

Policy/Safety constraints:
- The LLM must not be allowed to directly call arbitrary tools in production flows.
- All tool execution must pass through the Skill Executor’s allowed-tools boundary.

Failure modes:
- any missing capability -> fail-closed with a user-safe error message and telemetry

Observability:
- emit skill route + execution telemetry on every request

Acceptance criteria:
- code search finds no skills enablement runtime flags or branching modes
- message processor has no legacy agentic tool-loop for supported baseline skills

References:
- OpenAI Agents: tool-use best practice is to constrain tool execution paths via explicit interfaces and validations (Ref 1-4)

#### TASK-P0-002: Create canonical skill contract schema

What we are building:
- `src/server/features/ai/skills/contracts/skill-contract.ts`
- `src/server/features/ai/skills/contracts/slot-types.ts`

Why:
- Deterministic skill runtime needs strict contract validation before registration and execution.

Inputs:
- baseline skill list and capability names in this document

Outputs:
- zod parser and TS types for all skill files

Policy/Safety constraints:
- reject contracts that do not declare allowed tools
- reject contracts missing success checks/failure modes

Failure modes:
- invalid contract parse -> hard error at load time

Observability:
- emit contract-load success/failure metrics

Acceptance criteria:
- all skill files must parse through one schema
- unregistered or malformed skill fails build/runtime init

References:
- OpenAI structured output schema discipline (Ref 3, 4)
- Anthropic tool/skills structure guidance (Ref 1, 2)

#### TASK-P0-003: Establish baseline registry

What we are building:
- `src/server/features/ai/skills/registry/baseline-registry.ts`

Why:
- Closed-set routing requires a single authoritative list.

Inputs:
- validated contracts from `skills/baseline/*.ts`

Outputs:
- immutable `Map<SkillId, SkillContract>`

Policy/Safety constraints:
- no dynamic runtime registration in production path

Failure modes:
- duplicate skill IDs -> initialization failure

Observability:
- emit `skills.registry.loaded` with count

Acceptance criteria:
- exactly configured skills are loadable
- duplicate IDs are impossible without failing init

References:
- Anthropic skills modularity patterns (Ref 2)

### 32.2 Phase 1A Task Specs

#### TASK-P1A-001: Build closed-set skill router

What we are building:
- `src/server/features/ai/skills/router/route-skill.ts`
- `src/server/features/ai/skills/router/router-prompts.ts`

Why:
- replace broad mode classification with explicit skill routing.

Inputs:
- user message
- baseline skill IDs and intent examples

Outputs:
- `SkillRouteResult` with `skillId|null`, confidence, reason, optional clarification prompt

Policy/Safety constraints:
- router cannot emit unknown IDs
- low-confidence route cannot execute actions

Failure modes:
- model unavailable -> conservative null-route + clarification

Observability:
- `skill.route.started/completed` events with confidence

Acceptance criteria:
- all router outputs use valid baseline IDs only
- low confidence path asks one targeted question

References:
- Anthropic tool decision reliability patterns (Ref 1)
- OpenAI schema-constrained routing objects (Ref 3)

#### TASK-P1A-002: Build slot resolver + clarification generator

What we are building:
- `src/server/features/ai/skills/slots/resolve-slots.ts`
- `src/server/features/ai/skills/slots/slot-clarifications.ts`

Why:
- skills require deterministic preconditions before execution.

Inputs:
- selected skill contract
- message text
- context pack

Outputs:
- resolved slots, missing required slots, ambiguity list

Policy/Safety constraints:
- no mutation step may run when required slots missing

Failure modes:
- ambiguous slots -> clarification prompt, no execution

Observability:
- `skill.slot_resolution.completed` with missing/ambiguous counts

Acceptance criteria:
- missing required slots always block execution
- resolver output is deterministic for identical inputs

References:
- Structured planning/slot-filling reliability in tool-based agents (Ref 1, 3)

#### TASK-P1A-003: Build deterministic executor with allowed-tools enforcement

What we are building:
- `src/server/features/ai/skills/executor/execute-skill.ts`
- `src/server/features/ai/skills/executor/step-runner.ts`

Why:
- enforce execution boundary: no arbitrary tool calling in production path.

Inputs:
- selected skill contract
- resolved slots
- capability facade map

Outputs:
- `SkillExecutionResult`

Policy/Safety constraints:
- hard-block any step not in `allowed_tools`
- approval-required skills must pass approval gate before mutating calls

Failure modes:
- capability error -> normalized skill failure, no fake success

Observability:
- per-step emit: tool name, duration, result status

Acceptance criteria:
- executor cannot call undeclared capability
- execution stops on policy violation

References:
- MCP least-privilege / safe tool mediation (Ref 5)
- OpenAI/Anthropic tool-control guidance (Ref 1, 3)

#### TASK-P1A-004: Build postcondition validator

What we are building:
- `src/server/features/ai/skills/executor/postconditions.ts`

Why:
- prevent fabricated “success” responses.

Inputs:
- skill result payload
- expected success checks from contract

Outputs:
- pass/fail + reason code

Policy/Safety constraints:
- user success message cannot be emitted when postconditions fail

Failure modes:
- postcondition mismatch -> explicit failed/partial status

Observability:
- `skill.postcondition.completed` with reason

Acceptance criteria:
- mutation skills require confirmation evidence (e.g., created event id, modified count)

References:
- Eval-driven reliability and output validation patterns (Ref 4)

#### TASK-P1A-005: Build capability facades

What we are building:
- `src/server/features/ai/capabilities/email.ts`
- `src/server/features/ai/capabilities/calendar.ts`
- `src/server/features/ai/capabilities/planner.ts`
- `src/server/features/ai/capabilities/index.ts`

Why:
- decouple skill logic from polymorphic tool interfaces.

Inputs:
- existing tool/provider implementation paths

Outputs:
- narrow typed methods used by skills only

Policy/Safety constraints:
- no facade should expose raw polymorphic `resource/action` interface

Failure modes:
- underlying provider errors mapped to stable capability errors

Observability:
- capability call counters + latency histograms

Acceptance criteria:
- each facade method has a single responsibility and typed IO

References:
- API design best practice: narrow contracts improve reliability (Ref 1, 3)
- Google API method-specific contracts (Ref 6, 17, 18)

### 32.3 Phase 1B Task Specs

#### TASK-P1B-001..016: Implement 16 baseline skills

What we are building:
- `src/server/features/ai/skills/baseline/<skill-id>.ts` for all 16 skills

Why:
- convert high-frequency inbox/calendar workflows into deterministic skill plans.

Inputs:
- skill contract schema
- capability facades

Outputs:
- validated contracts with explicit slots/plans/checks/failures/templates

Policy/Safety constraints:
- each skill declares allowed capabilities
- mutation skills define approval behavior

Failure modes:
- all skill files must include failure modes with user-safe fallback copy

Observability:
- skill-level success/failure metrics

Acceptance criteria:
- each skill compiles, validates, and registers
- each skill has contract-complete metadata

References:
- Gmail and Calendar primitive docs for relevant actions (Ref 6, 8-13, 17, 18)

### 32.4 Phase 2 Task Specs

#### TASK-P2-001: Integrate skills path in message processor

What we are building:
- update `src/server/features/ai/message-processor.ts` to:
  - run orchestration preflight first
  - if `needsTools=false`, generate a conversational reply without invoking skills router/slots/executor
  - if `needsTools=true`, run skills router/slots/executor and return that output

Why:
- reduce latency and LLM/tool costs for conversational turns
- maintain a hard boundary: skills is the only operational action path

Inputs:
- skills runtime modules
- `src/server/features/ai/orchestration/preflight.ts`

Outputs:
- single dispatch path: `(preflight -> chat | skills runtime)`

Policy/Safety constraints:
- must not execute any mutating skill when `needsTools=false`

Failure modes:
- preflight failure -> conservative default (conversational) and ask a clarifying question if needed

Observability:
- log preflight decision + whether skills runtime was invoked

Acceptance criteria:
- conversational turns do not call skill router/slots/executor
- operational turns always call skills router/slots/executor

References:
- tool-mediated boundaries and validation discipline (Ref 1, 3, 5)

#### TASK-P2-002: (Removed) Shadow/Legacy Comparator

This repo is skills-only and does not maintain a legacy runtime to compare against.

### 32.5 Phase 3 Task Specs

#### TASK-P3-001: Minimize system prompt to policy/style shell

What we are building:
- refactor `src/server/features/ai/system-prompt.ts`

Why:
- remove operational logic from prompt and prevent prompt sprawl.

Inputs:
- existing prompt and skills contracts

Outputs:
- slim prompt with only global policy/style/injection constraints

Policy/Safety constraints:
- preserve anti-injection and approval policy statements

Failure modes:
- accidental removal of core safety policy

Observability:
- prompt length and sections tracked in PR notes

Acceptance criteria:
- operational procedures now live in skills, not prompt prose

References:
- tool-mediated vs prompt-only reliability guidance (Ref 1, 3)

### 32.6 Phase 4 Task Specs

#### TASK-P4-001: Canary rollout operations

What we are building:
- skills-only deploy discipline with telemetry-driven regression detection

Why:
- this repo intentionally has no runtime mode switches; correctness comes from contracts + telemetry + fast deploy iteration

Inputs:
- telemetry dashboards

Outputs:
- stable production behavior without runtime feature flags

Policy/Safety constraints:
- do not add skills runtime mode flags (no `off|shadow|on`)

Failure modes:
- regression -> ship fix or revert deploy via git

Observability:
- monitor gates in Section 9.1

Acceptance criteria:
- skills-only behavior holds in production

References:
- eval-driven reliability and validation (Ref 4)

### 32.7 Phase 5 Task Specs

#### TASK-P5-001: Delete legacy covered paths

What we are building:
- remove legacy branches for baseline-covered intents

Why:
- reduce maintenance cost and prevent dual-runtime drift.

Inputs:
- stability evidence from telemetry + eval gates

Outputs:
- deleted legacy code + simpler runtime graph

Policy/Safety constraints:
- no deletion before gates pass

Failure modes:
- accidental removal of required legacy behavior

Observability:
- change in codepath selection counters

Acceptance criteria:
- no runtime reference to removed path for covered intents

References:
- tool-mediated boundaries and validation discipline (Ref 1, 3)

---

## 33) Per-Skill Acceptance Matrix (Why + Done Criteria + References)

Use this matrix during implementation reviews. A skill is not “done” unless all criteria pass.

| Skill | Why it exists | Hard acceptance criteria | Key references |
|---|---|---|---|
| `inbox_triage_today` | Users need immediate actionable priority queue | Returns ranked actionable list; excludes low-signal noise; no destructive action | Ref 14, 15 |
| `inbox_bulk_newsletter_cleanup` | Inbox overload from promos/newsletters | Candidate detection + explicit count + safe archive execution with ownership checks | Ref 17, 8, 10 |
| `inbox_subscription_control` | Reduce recurring inbox noise permanently | Unsubscribe/block action uses sender evidence and returns explicit status | Ref 10, 17 |
| `inbox_snooze_or_defer` | Preserve focus without losing threads | Valid future defer time required; all target threads confirm deferred state | Ref 17 |
| `inbox_thread_summarize_actions` | Long thread digestion | Output has decisions/actions/deadlines sections with no hallucinated actions | Ref 1, 3 |
| `inbox_draft_reply` | Fast response drafting | Creates draft ID with recipient + intent completeness; no send side effects | Ref 17, 3 |
| `inbox_schedule_send` | Better send timing | Valid schedule window, provider confirmation, timezone handling | Ref 9, 17 |
| `inbox_followup_guard` | Prevent dropped conversations | Identifies awaiting-reply risk set; proposes concrete nudges | Ref 14, 15 |
| `calendar_find_availability` | Scheduling speed | Returns conflict-aware candidate slots from freebusy data | Ref 6, 18 |
| `calendar_schedule_from_context` | Convert context to event quickly | Event created with attendees/title/time, returns event ID | Ref 6, 11 |
| `calendar_reschedule_with_constraints` | Reduce schedule friction | Maintains duration + attendee constraints when moving event | Ref 6 |
| `calendar_focus_time_defense` | Defend deep work blocks | Focus blocks created/updated and conflict policy enforced | Ref 11 |
| `calendar_working_hours_ooo` | Enforce boundaries | Working hours/OOO persisted with explicit user-visible summary | Ref 12 |
| `calendar_booking_page_setup` | External scheduling automation | Appointment schedule created with duration/buffer/cap constraints | Ref 13 |
| `calendar_meeting_load_rebalance` | Reduce meeting overload | Identifies movable meetings and reports reclaimed focus time | Ref 14, 15 |
| `daily_plan_inbox_calendar` | Unified daily execution plan | Produces integrated plan combining email priorities + meetings + focus windows | Ref 14, 15 |

---

## 34) Additional References for Engineering Constraints

16. OpenTelemetry HTTP semantic conventions: https://opentelemetry.io/docs/specs/semconv/http/http-spans/
17. Gmail API `users.messages.batchModify`: https://developers.google.com/workspace/gmail/api/reference/rest/v1/users.messages/batchModify
18. Google Calendar API `freeBusy.query`: https://developers.google.com/workspace/calendar/api/v3/reference/freebusy/query
19. RFC 7231 idempotent methods (HTTP semantics): https://www.rfc-editor.org/rfc/rfc7231.html
20. Google Cloud retry strategy (truncated exponential backoff + jitter): https://cloud.google.com/iam/docs/retry-strategy
21. Google Memorystore exponential backoff guidance: https://docs.cloud.google.com/memorystore/docs/redis/exponential-backoff
22. Google API retry recommendation (`RetryInfo`): https://developers.google.com/data-manager/api/reference/rest/v1/RetryInfo
23. LaunchDarkly release management best practices: https://launchdarkly.com/guides/9-best-practices-for-release-management/release-management-best-practices/
24. LaunchDarkly release flag rollout patterns: https://launchdarkly.com/blog/release-management-flags-best-practices/

---

## 35) Edge-Case Catalog (Mandatory Handling Before Merge)

This catalog is binding. Each item must have explicit handling in code and telemetry.

### 35.1 Router Edge Cases

1. Empty input (`""`, whitespace, emoji-only)
- Handling: return `skillId=null`, ask concise clarification.
- Must not execute capabilities.

2. Multi-intent input (“archive newsletters and schedule with Alex tomorrow”)
- Handling: choose single primary skill + ask disambiguation for second intent.
- Must not silently drop secondary intent; emit explicit telemetry that a secondary intent was deferred.

3. Ambiguous intent with high lexical overlap (`inbox_followup_guard` vs `inbox_triage_today`)
- Handling: confidence tie-breaker by slot resolvability and risk level.
- If tie persists, clarify.

4. Adversarial/tool-injection text in user message
- Handling: router treats as plain text intent, never as executable instructions.
- Preserve existing anti-injection policy in system prompt.

5. Very long input near token boundaries
- Handling: truncate for routing summary only; preserve full text for downstream context if needed.
- Emit `route_input_truncated=true`.

6. Non-English or mixed-language phrasing
- Handling: attempt route, lower confidence threshold not allowed; clarify if below threshold.

### 35.2 Slot Resolver Edge Cases

1. Relative datetime ambiguity (“next Friday afternoon”, “this Thursday” across timezone boundaries)
- Handling: resolve with account timezone; if ambiguous (DST/locale), ask one clarifying question.
- Reference: date/time semantics and timezone handling best practices (Ref 6, 18, 19).

2. DST gap/overlap times
- Handling: detect invalid local time and offer closest valid alternatives.
- Emit `slot_ambiguous_reason=dst_overlap_or_gap`.

3. Pronoun attendees (“with them”, “with the team”)
- Handling: use deterministic context resolution only if single high-confidence match; otherwise clarify.

4. Missing required slot after context fallback
- Handling: block execution and ask targeted question (exact missing slot names).

5. Conflicting slot evidence (thread says one attendee, user message says another)
- Handling: prefer explicit current user message and log conflict.

6. Untrusted derived slot from external content
- Handling: do not treat external content as authoritative instruction source.

### 35.3 Executor Edge Cases

1. Duplicate request replay (same user prompt retried)
- Handling: idempotency key on `message|thread|conversation` scope based on skill contract.
- Must return prior result when safe.

2. Partial success in multi-step plan
- Handling: return `partial` status with explicit completed vs skipped actions.
- Never return full success on partial mutation.

3. Capability timeout mid-plan
- Handling: bounded retries with jitter only for idempotent steps; fail safely otherwise.
- References: backoff and retry guidance (Ref 20, 21, 22).

4. Rate-limit responses from providers
- Handling: normalize to retriable/non-retriable and expose user-safe guidance.

5. Approval required but missing approval context
- Handling: block with approval-required response template; no mutation.

6. Out-of-contract capability request from skill plan
- Handling: hard fail + security event (`allowed_tools_violation`).

### 35.4 Gmail Capability Edge Cases

1. Pagination incomplete reads
- Handling: explicit page-token loop for operations requiring full scope.

2. Incremental sync invalid/expired `startHistoryId` (`HTTP 404`)
- Handling: force a full resync for that account and record an operational warning (do not loop).
- Reference: Gmail history docs (Ref 25).

3. Batch archive over allowed limits
- Handling: chunk request sizes and aggregate result.

4. Missing unsubscribe metadata
- Handling: soft-fail with recommended manual sender block path.

5. Draft exists but send scheduling fails
- Handling: preserve draft state, return schedule failure, no draft deletion.

### 35.5 Calendar Capability Edge Cases

1. Push watch for unsupported resources/calendars
- Handling: do not attempt watch on non-watchable resources; skip and log at info/warn.
- Reference: push watchable resources docs (Ref 26/turn0search2).

2. Holiday/resource calendars returning `pushNotSupportedForRequestedResource`
- Handling: classify as expected non-actionable warning, no error escalation.

3. Recurring event updates (`this event` vs `series` vs `this and following`)
- Handling: require explicit scope; use two-step split pattern for “this and following”.
- Reference: recurring event docs (Ref 27/turn0search1).

4. Event type constraints (`focusTime`, `outOfOffice`, `workingLocation`)
- Handling: validate required fields and allowed operations before mutation.
- Reference: status events guide and events API constraints (Ref 16, 6, 7).

5. Moving event types that cannot be moved
- Handling: block with explicit policy error; suggest alternative.
- Reference: events method constraints (Ref 7).

6. Free/busy no overlap
- Handling: return alternatives (wider window, shorter duration) instead of generic failure.

### 35.6 Telemetry Edge Cases

1. High-cardinality attributes (raw user IDs, thread IDs, free-form text)
- Handling: hash IDs, never emit message text, cap label cardinality.
- Reference: OpenTelemetry cardinality and attribute requirement guidance (Ref 28, 29, 30).

2. Telemetry emitter outage
- Handling: fail-open (runtime unaffected), buffered/no-op fallback.

3. Sensitive payload leakage
- Handling: strict field allowlist for events.

### 35.7 Deployment and Operations Edge Cases (Skills-Only)

1. Cross-deploy stale clients (e.g., older server action ids)
- Handling: return deterministic stale-action response and refresh guidance.

2. Env drift across regions/services
- Handling: startup log of effective non-secret config checksum; fail fast on missing required secrets.

3. Regression spike after deploy
- Handling: revert deploy via git; open root-cause issue with `skill_id`, `requestId`, and tool chain.

---

## 36) Edge Cases by Baseline Skill (Atomic Checklist)

Each skill implementation PR must check all relevant edge cases below.

### 36.1 Inbox Skills

`inbox_triage_today`
- edge cases:
  - no actionable messages today
  - conflicting urgency signals
  - duplicate threads in results

`inbox_bulk_newsletter_cleanup`
- edge cases:
  - important transactional email misclassified as newsletter
  - large result set > provider page/chunk limits
  - unsubscribe-only threads with no archive candidate

`inbox_subscription_control`
- edge cases:
  - sender has no unsubscribe header/link
  - multiple sender variants for same list
  - sender belongs to allowlist

`inbox_snooze_or_defer`
- edge cases:
  - defer time in the past
  - timezone unknown
  - mixed thread ownership or missing thread ids

`inbox_thread_summarize_actions`
- edge cases:
  - thread too long/truncated upstream
  - no explicit action items in thread
  - contradictory statements across replies

`inbox_draft_reply`
- edge cases:
  - recipient unresolved
  - missing intent/body
  - conflicting tone instructions

`inbox_schedule_send`
- edge cases:
  - draft id missing/not owned
  - send time outside provider constraints
  - daylight-saving transition at send time

`inbox_followup_guard`
- edge cases:
  - replied threads misdetected as awaiting reply
  - very old threads causing noise
  - duplicate follow-up candidates

### 36.2 Calendar Skills

`calendar_find_availability`
- edge cases:
  - participants without calendars/access
  - no overlap window
  - duration too long for requested window

`calendar_schedule_from_context`
- edge cases:
  - pronoun attendee ambiguity
  - invalid start/duration combination
  - duplicate event creation request

`calendar_reschedule_with_constraints`
- edge cases:
  - immutable/non-movable event type
  - recurring instance scope ambiguity
  - no valid slots under constraints

`calendar_focus_time_defense`
- edge cases:
  - all-day request invalid for focusTime
  - overlaps with hard commitments
  - auto-decline mode unsupported

`calendar_working_hours_ooo`
- edge cases:
  - invalid working-hours range
  - overlapping out-of-office windows
  - location visibility constraints

`calendar_booking_page_setup`
- edge cases:
  - invalid buffer/cap configuration
  - timezone missing
  - conflicting existing booking policies

`calendar_meeting_load_rebalance`
- edge cases:
  - meetings with immovable attendees
  - recurring series over-modification risk
  - reclaimed-time below threshold

`daily_plan_inbox_calendar`
- edge cases:
  - one source unavailable (email/calendar outage)
  - too many candidate actions for readable output
  - conflicting priorities from user prefs vs urgency model

---

## 37) Reference Coverage Matrix (Every Area -> External Docs)

This matrix enforces that every implementation area is grounded in online references.

| Area | Required refs |
|---|---|
| Tool-mediated agent boundaries | Ref 1, 2, 3, 5 |
| Structured outputs / schema contracts | Ref 3, 4 |
| Retry / idempotency / backoff | Ref 19, 20, 21, 22 |
| Gmail operations and sync behavior | Ref 17, 25 |
| Calendar event mutation behavior | Ref 6, 7, 16, 18, 27 |
| Calendar push/watch behavior | Ref 26 |
| OAuth installation and scope errors (Slack sidecar onboarding reliability) | Ref 31 |
| Canary and release safety | Ref 23, 24, 32 |
| Telemetry semantic + cardinality safety | Ref 28, 29, 30 |
| HTTP error envelope conventions | Ref 33 |

Rule:
- Every implementation PR must cite at least one reference from this matrix for each area touched.

---

## 38) PR-Level Atomic Acceptance Template

Each implementation PR in this migration must include:

1. Scope
- exact files changed
- exact tasks (Task IDs)

2. Behavioral delta
- what changed in runtime behavior
- what did not change

3. Edge cases handled
- explicit list from Section 35/36

4. Observability updates
- events added/changed
- dashboards impacted

5. Documentation basis
- references used (IDs + URLs)

6. Rollback strategy
- config or commit-level rollback steps

A PR that does not include this template is not ready for merge.

---

## 39) Additional References (Edge-Case and Ops Grounding)

25. Gmail `users.history.list` (invalid/outdated `startHistoryId` and full sync guidance): https://developers.google.com/workspace/gmail/api/reference/rest/v1/users.history/list
26. Google Calendar push notifications/watchable resources: https://developers.google.com/workspace/calendar/api/guides/push
27. Google Calendar recurring event mutation guidance: https://developers.google.com/calendar/api/guides/recurringevents
28. OpenTelemetry semantic conventions overview: https://opentelemetry.io/docs/concepts/semantic-conventions/
29. OpenTelemetry attribute requirement levels and cardinality implications: https://opentelemetry.io/docs/specs/semconv/general/attribute-requirement-level/
30. OpenTelemetry convention writing guidance (PII and attribute discipline): https://opentelemetry.io/docs/specs/semconv/how-to-write-conventions/
31. Slack OAuth install errors (`invalid_scope`, `bad_redirect_uri`): https://docs.slack.dev/authentication/installing-with-oauth
32. Google SRE canarying releases: https://sre.google/workbook/canarying-releases/
33. RFC 9457 Problem Details for HTTP APIs: https://datatracker.ietf.org/doc/html/rfc9457
