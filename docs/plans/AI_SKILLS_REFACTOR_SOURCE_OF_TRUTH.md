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

No new skill/pack can roll out unless canary + eval gates pass.

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
  - no `AI_SKILLS_MODE` / `AI_SKILLS_FALLBACK_LEGACY` env flags in `src/env.ts`

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

Result: mostly **not yet implemented** after rollback.

- `SkillContract schema`: missing
- `Skill Router (closed-set baseline)`: missing
- `Skill Executor + postconditions`: missing
- `Tool Facades`: missing (current tools remain polymorphic)
- `Skill telemetry`: partial at tool meta/audit level only
- `16 baseline skills`: missing
- `AI_SKILLS_MODE / fallback flags`: missing
- `shadow mode`: missing
- `controlled cutover`: missing
- `legacy cleanup`: missing

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

## 9.1 Feature Flags

Add to `src/env.ts`:

- `AI_SKILLS_MODE`: `off|shadow|on`
- `AI_SKILLS_FALLBACK_LEGACY`: `true|false`
- `AI_SKILLS_CANARY_PERCENT`: `0-100` integer
- `AI_SKILLS_BASELINE_ONLY`: `true|false` (default true)

## 9.2 Runtime Routing

- `off`: legacy flow only
- `shadow`: legacy response returned; skills flow executes in parallel and logs comparison
- `on`: skills flow serves user response, optional legacy fallback by flag

## 9.3 Canary Strategy

When `on`:

1. 5% internal accounts
2. 20% mixed accounts
3. 50%
4. 100%

Progress only if gates pass for 24h per stage.

## 9.4 Success Gates (Production)

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

- install flags
- define contracts and repo structure
- freeze boundary decisions

Tasks:

1. Add flags in `src/env.ts`.
2. Create `src/server/features/ai/skills/**` module skeleton.
3. Create contract schema in `skills/contracts/skill-contract.ts`.
4. Add architecture ADR doc (optional) under `docs/architecture/`.
5. Update `src/server/features/ai/README.md` to point to this plan doc.

Exit criteria:

- Skills modules compile.
- Env flags parsed in all deploy environments.

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

- integrate skills path behind flags
- preserve legacy fallback while shadowing

Tasks:

1. Update `src/server/features/ai/message-processor.ts`:
   - run router/slots/executor when mode is `shadow|on`
   - preserve legacy behavior in `off`
2. Add side-by-side comparison logging in shadow mode.
3. Ensure approvals still pass through existing approval services.

Exit criteria:

- Shadow mode running with no user-visible behavior change.

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

- skills path serves production for baseline intents

Tasks:

1. Turn `AI_SKILLS_MODE=on` for canary cohort.
2. Track gates and mismatch categories daily.
3. Disable legacy fallback when stable.

Exit criteria:

- gates achieved at 100% rollout.

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
3. Integrate shadow mode
4. Add remaining 8 baseline skills
5. Cutover and delete legacy path

---

## 14) Deprioritized Tests Policy (This Refactor Only)

For this execution cycle:

- Do not spend cycles on broad unit test expansion.
- Do add only minimal smoke checks for:
  - skill contract parsing
  - router emits valid registered skill
  - executor rejects out-of-contract tool invocation
- Primary quality mechanism is telemetry + shadow comparison + canary gates.

After cutover stabilizes, backfill deeper tests for long-term regression resistance.

---

## 15) Definition of Done

Done means all are true:

1. Baseline skill runtime active in production.
2. Legacy prompt-driven path disabled for covered Gmail/Calendar core intents.
3. Gates achieved (Section 9.4).
4. No boundary violations in policy/execution.
5. Documentation updated and onboarding for domain packs complete.

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
7. Rollout controls (env flags, shadow/on gating)
8. Legacy cleanup (dead-path deletion + docs updates)

### 17.2 Milestone Slices (Ship Order)

M0:
- add new module skeleton
- add env flags
- add contract schema
- no behavioral change

M1:
- router + slot resolver + executor skeleton
- 2 pilot skills wired but behind `AI_SKILLS_MODE=off`

M2:
- shadow mode integration in message processor
- telemetry events and comparison logging

M3:
- first 8 baseline skills production-ready
- canary rollout readiness

M4:
- all 16 baseline skills
- prompt minimization completed

M5:
- rollout complete, legacy branch deletion pass

### 17.3 Artifact Checklist Per Milestone

M0 artifacts:
- `src/server/features/ai/skills/contracts/skill-contract.ts`
- `src/server/features/ai/skills/contracts/slot-types.ts`
- `src/server/features/ai/skills/registry/baseline-registry.ts`
- `src/env.ts` updated with skills flags

M1 artifacts:
- `src/server/features/ai/skills/router/route-skill.ts`
- `src/server/features/ai/skills/slots/resolve-slots.ts`
- `src/server/features/ai/skills/executor/execute-skill.ts`
- `src/server/features/ai/capabilities/index.ts`

M2 artifacts:
- message processor wiring for `off|shadow|on`
- telemetry schema and emitters
- shadow diff logger with mismatch categories

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
- fallback disabled for baseline intents
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
- fallback result with single-clarification prompt

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
- telemetry emitters + safe no-op fallback

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
- honor env mode flags
- shadow comparator hooks
- fallback behavior control

`src/env.ts`
- parse and validate skills env flags

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
- `skills_mode`

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

## 25) Shadow Mode Comparison and Mismatch Taxonomy

Shadow comparator outputs:

- `legacy_outcome`
- `skills_outcome`
- `mismatch_category`
- `operator_summary`

Mismatch categories:

1. `ROUTE_DIFFERENCE`
2. `SLOT_INSUFFICIENT`
3. `ACTION_DIFFERENCE`
4. `POSTCONDITION_DIFFERENCE`
5. `SAFETY_BLOCK_DIFFERENCE`
6. `OUTPUT_QUALITY_DIFFERENCE`

Promotion rule:
- canary cannot progress while `ACTION_DIFFERENCE` or `SAFETY_BLOCK_DIFFERENCE` exceeds threshold.

---

## 26) Rollout Operations Runbook

Pre-rollout checklist:

1. Set `AI_SKILLS_MODE=shadow`
2. Set `AI_SKILLS_BASELINE_ONLY=true`
3. Verify telemetry dashboards receive events
4. Verify kill switch path (`AI_SKILLS_MODE=off`) on live env

Canary checklist:

1. Enable `AI_SKILLS_MODE=on`
2. Set `AI_SKILLS_CANARY_PERCENT=5`
3. Monitor gates for 24h
4. Increase only if all gates pass

Incident rollback:

1. Set `AI_SKILLS_MODE=off` immediately
2. Preserve logs and mismatch events
3. Open root-cause issue with skill id + request ids
4. Patch and re-enter shadow before next on attempt

---

## 27) Legacy Cleanup Manifest (Deletion Targets)

Deletion targets are executed only after M4 stabilization.

Candidate cleanup areas:

- preflight logic branches no longer used for baseline skills
- prompt sections replaced by skill contracts
- message-processor fallback branches for covered intents
- any ad-hoc intent mapping logic duplicated by router

Deletion process:

1. Mark candidate code with `@legacy-skill-migration` comments.
2. Confirm no callsites in `on` mode.
3. Delete in small slices with rollback-safe commits.

---

## 28) Session Context Retention Protocol

For long implementation runs, update this plan at end of each session with:

- current milestone (`M0-M5`)
- completed artifacts
- blocked artifacts
- exact next file to edit
- flags status per environment

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

## 29) Immediate Execution Queue (Next 10 Concrete Steps)

1. Add env flags in `src/env.ts`.
2. Add `skills/contracts/skill-contract.ts`.
3. Add `skills/contracts/slot-types.ts`.
4. Add `skills/registry/baseline-registry.ts` with empty stubs.
5. Add `skills/router/route-skill.ts` with closed-set return type.
6. Add `skills/slots/resolve-slots.ts` with required-slot output contract.
7. Add `skills/executor/execute-skill.ts` with allowed-tools guard.
8. Add `ai/capabilities/email.ts` wrappers for triage/cleanup/draft primitives.
9. Add 2 pilot skills: `inbox_triage_today`, `calendar_find_availability`.
10. Integrate `AI_SKILLS_MODE=shadow` path in `message-processor.ts`.

---

## 30) Build Outcome Clarification

When this full plan is executed end-to-end, the intended outcome is:

1. Production runtime is skill-centric for core inbox/calendar actions.
2. Prompt sprawl is minimized and no longer controls operational behavior.
3. Legacy generic path is disabled for covered intents.
4. Codebase complexity decreases by removing duplicated orchestration logic.
5. Domain-specific packs become additive modules, not core rewrites.

Current status at this moment:

- This document now includes detailed audit + build execution detail.
- Migration code is not yet implemented in this pass.
