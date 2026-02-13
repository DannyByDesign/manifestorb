# Unified Rule Plane Migration Plan

## Objective

Move from fragmented rule/policy systems to a canonical rule plane without breaking approval safety or automation behavior.

## Legacy Surfaces To Migrate

## Email automation

- Models:
  - `Rule`, `Action`, `ExecutedRule`, `ScheduledAction`
  - `prisma/schema.prisma`
- Runtime:
  - `src/server/features/webhooks/process-history-item.ts`
  - `src/server/features/rules/ai/run-rules.ts`
  - `src/server/features/rules/ai/execute.ts`
  - `src/server/features/ai/actions.ts`
  - `src/server/features/scheduled/executor.ts`

## Approval policy

- Models:
  - `ApprovalPreference`, `ApprovalRequest`, `ApprovalDecision`
- Runtime:
  - `src/server/features/approvals/rules.ts`
  - `src/server/features/approvals/service.ts`
  - `src/server/features/approvals/execute.ts`
  - `src/server/features/ai/skills/executor/execute-skill.ts`
  - `src/server/features/ai/planner/execute-plan.ts`

## Calendar policy

- Models:
  - `CalendarEventPolicy`
- Runtime:
  - `src/server/features/calendar/policy-rules.ts`
  - `src/server/features/calendar/canonical-state.ts`
  - `src/server/features/calendar/adaptive-replanner.ts`
  - `src/server/features/calendar/scheduling/TaskSchedulingService.ts`

## Target New Storage

Add canonical tables (names tentative):

1. `CanonicalRule`
2. `CanonicalRuleVersion`
3. `PolicyDecisionLog`
4. `PolicyExecutionLog`

Legacy tables remain until cutover complete.

## Migration Strategy

## Stage 0: Foundation (no behavior change)

1. Introduce canonical types and validators in code.
2. Introduce PDP module that can evaluate legacy-backed policy rules.
3. Add adapters that map legacy entities to canonical in-memory rules.
4. Add decision logging in non-blocking mode (shadow log).

Exit criteria:

- Existing behavior unchanged.
- PDP can evaluate for all known mutation intents.

## Stage 1: Read-Through Canonicalization

1. Build read adapters:
- ApprovalPreference -> canonical guardrail rules
- Rule/Action -> canonical automation rules
- CalendarEventPolicy -> canonical preference/guardrail rules
2. Route skills/planner policy checks through PDP (still reading legacy data through adapters).
3. Keep existing approval object creation path.

Exit criteria:

- Skills/planner policy decisions produced by PDP.
- Decision logs captured for interactive mutations.

## Stage 2: Automation/Scheduled Enforcement

1. Add PDP enforcement at automation execution boundary before every mutating action.
2. Add PDP enforcement at scheduled executor boundary.
3. Remove direct execution path that can skip policy evaluation.
4. Ensure `require_approval` creates actionable approval objects in automation/scheduled context.

Exit criteria:

- No mutating automation action executes without PDP decision.
- No scheduled mutation executes without PDP decision.

## Stage 3: Canonical Persistence + Dual Write

1. Add write-path to persist canonical rules for create/update/delete via UI and AI.
2. Keep legacy writes in parallel (dual write) with reconciliation checks.
3. Add parity checker job:
- Compare legacy-derived canonical view vs persisted canonical rules.
- Alert on mismatches.

Exit criteria:

- Dual-write parity stable.
- No critical mismatches in production logs.

## Stage 4: Canonical Read Cutover

1. Switch PDP + automation matcher to read canonical tables only.
2. Keep legacy fallback read path for rollback window.
3. Freeze legacy schema writes except rollback tooling.

Exit criteria:

- All decisions and matches run from canonical data.
- Rollback tested.

## Stage 5: Legacy Decommission

1. Remove legacy runtime dependencies incrementally.
2. Drop or archive legacy-only fields/tables after retention period.
3. Keep migration audit artifact for compliance/support.

Exit criteria:

- Canonical rule plane is sole runtime source.

## Data Mapping Rules

## ApprovalPreference -> Canonical guardrail

- `toolName` + policy config -> `match.resource/operation` + `decision`
- Conditional policies -> `match.conditions`
- User-level ownership -> `owner.userId`

## Rule + Action -> Canonical automation

- Rule conditions -> `match.conditions`
- Action list -> `actionPlan.actions`
- Existing metadata (`enabled`, `expiresAt`) preserved
- Trigger default: `event/email.received` unless explicit legacy semantics require thread-level trigger metadata

## CalendarEventPolicy -> Canonical preference/guardrail

- Event/global scope preserved in `scope` + `match.conditions`
- `reschedulePolicy=FIXED` -> guardrail `block` for reschedule/move
- `APPROVAL_REQUIRED` -> guardrail `require_approval`
- `FLEXIBLE` + notify flags -> preference rules

## Runtime Integration Checklist by File

- Skills: `src/server/features/ai/skills/executor/execute-skill.ts`
- Planner: `src/server/features/ai/planner/execute-plan.ts`
- Rules execution: `src/server/features/rules/ai/execute.ts`
- Action dispatch: `src/server/features/ai/actions.ts`
- Webhook processor: `src/server/features/webhooks/process-history-item.ts`
- Scheduled executor: `src/server/features/scheduled/executor.ts`
- Calendar replanner: `src/server/features/calendar/adaptive-replanner.ts`
- Task scheduling service: `src/server/features/calendar/scheduling/TaskSchedulingService.ts`

## Risk Controls

1. Never enable canonical write cutover before PDP coverage for all mutating paths.
2. Never report success unless provider call result is confirmed.
3. Approval-required must always return actionable approval payload (no dead-end text).
4. Store idempotency keys for approval and execution replay safety.

## Rollback Plan

1. Keep legacy read/write paths behind internal toggles until Stage 5.
2. On critical regressions:
- switch PDP reads back to legacy adapters,
- replay pending approvals from persisted approval tables,
- preserve decision logs for postmortem.

## Success Metrics

1. Policy bypass count for mutating operations: `0`.
2. Unsupported action reported as success: `0`.
3. Approval-required without approval object: `0`.
4. Clarification/approval continuation failure rate: < 1%.
