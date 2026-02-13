# Unified Rule Plane Architecture

## Purpose

Define one policy and automation plane for Amodel so guardrails, automations, and behavior preferences are evaluated consistently across:

- interactive AI execution (skills + planner),
- inbound event automations (email/calendar webhooks),
- delayed/scheduled execution.

This document is the implementation architecture reference.

## Non-Negotiable Boundaries

1. One canonical rule schema for `guardrail`, `automation`, and `preference`.
2. One policy decision point (PDP) for all mutating operations.
3. One automation executor that reads canonical rules and emits canonical execution logs.
4. NL rule authoring must compile into canonical schema and pass validation before activation.
5. All runtime decisions must be auditable from user NL source to final execution outcome.

## Current Fragmentation (Verified)

### Chat runtime policy checks

- Skills executor checks approval policy pre-mutation:
  - `src/server/features/ai/skills/executor/execute-skill.ts`
- Planner fallback checks approval policy pre-step:
  - `src/server/features/ai/planner/execute-plan.ts`

### Automation/scheduled bypasses

- Email webhook rules call `runRules` then execute actions directly:
  - `src/server/features/webhooks/process-history-item.ts`
  - `src/server/features/rules/ai/run-rules.ts`
  - `src/server/features/rules/ai/execute.ts`
- Delayed actions execute `runActionFunction` directly:
  - `src/server/features/scheduled/executor.ts`
  - `src/server/features/ai/actions.ts`

### Separate calendar policy subsystem

- Calendar policy rules and decisions are separate from approval/rules runtime:
  - `src/server/features/calendar/policy-rules.ts`
  - `src/server/features/calendar/canonical-state.ts`
  - `src/server/features/calendar/adaptive-replanner.ts`

## Target Architecture

## Components

1. Canonical Rule Store
- Single normalized schema for all rule types.
- Backed by migration adapters from legacy `Rule`, `ApprovalPreference`, `CalendarEventPolicy`.

2. Policy Decision Point (PDP)
- Single function: evaluate one mutating intent against canonical rules.
- Output contract:
  - `allow`
  - `block`
  - `require_approval`
  - `allow_with_transform`

3. Policy Enforcement Points (PEPs)
- Skills executor mutation steps.
- Planner mutation steps.
- Automation action dispatch.
- Scheduled action execution.
- Autonomous calendar/task replanners.

4. Event-Driven Automation Executor
- Consumes normalized event envelope.
- Matches canonical automation rules.
- Executes via same capability/action contract that goes through PDP.

5. Rule Compiler + Explain Loop
- NL input -> candidate canonical rule AST -> schema validation -> conflict checks -> activation.
- Deterministic explanation of:
  - what was understood,
  - what will execute,
  - where approval is required.

6. Unified Audit Trail
- Source NL
- Compiled canonical rule JSON
- PDP decision records
- Execution action logs
- Approval request/decision linkage

## Runtime Flow (Target)

### A) Interactive skill/planner mutation

1. Route user intent to skill or planner.
2. Build mutation intent payload (`resource`, `operation`, `targets`, `args`, `actor`, `context`).
3. Call PDP.
4. Apply result:
- `allow`: execute mutation
- `allow_with_transform`: execute transformed mutation
- `require_approval`: create approval request and return actionable payload
- `block`: return deterministic blocked reason
5. Log decision + execution.

### B) Webhook automation mutation

1. Inbound event normalized to canonical event envelope.
2. Match canonical automation rules.
3. For each emitted action, call PDP before execution.
4. Handle PDP result with same semantics as interactive runtime.
5. Persist decision and execution logs.

### C) Scheduled execution mutation

1. Scheduled item resolves to canonical action intent.
2. Call PDP at execution time.
3. Execute/approve/block using same semantics.
4. Persist logs.

## Hard Invariants

1. No mutating action executes without a PDP decision record.
2. `require_approval` never returns plain text only; it always creates an actionable approval object.
3. Unsupported/invalid action can never return success status.
4. Policy behavior is source-agnostic: same intent + same context => same policy decision, regardless of chat/webhook/scheduler origin.
5. Rule priority and conflict resolution are deterministic and stable.

## File-Level Consolidation Targets

- Legacy rules engine:
  - `src/server/features/rules/ai/run-rules.ts`
  - `src/server/features/rules/ai/execute.ts`
  - `src/server/features/ai/actions.ts`
  - `src/server/features/scheduled/executor.ts`
- Existing approval policy engine:
  - `src/server/features/approvals/rules.ts`
  - `src/server/features/approvals/service.ts`
  - `src/server/features/approvals/execute.ts`
- Skill/planner policy call sites:
  - `src/server/features/ai/skills/executor/execute-skill.ts`
  - `src/server/features/ai/planner/execute-plan.ts`
- Calendar policy subsystem:
  - `src/server/features/calendar/policy-rules.ts`
  - `src/server/features/calendar/canonical-state.ts`
  - `src/server/features/calendar/adaptive-replanner.ts`
  - `src/server/features/calendar/scheduling/TaskSchedulingService.ts`

## Execution Phases

1. Canonical schema + adapters.
2. PDP integration in skills/planner.
3. Automation + scheduled executor integration.
4. Preference-rule constraint integration.
5. NL compiler + explanation loop.
6. Unified UI + AI rule management skills.
7. Evals + telemetry dashboards.

## Done Criteria

1. No policy bypass on mutating actions.
2. No unsupported action reported as success.
3. Approval-required actions always yield actionable approval objects.
4. Multi-turn approval/clarification resumes remain correct after unification.
5. Rule decisions and executions are fully traceable in logs.
